// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SettlementAttestationOracle - atestacao de liquidacao instantanea (v3)
 * @notice Sucessor do PixAttestationOracle. A v1 assinava
 *             Receipt(txid, e2eIdHash, amount, settled)
 *         e isso quebrava a propria promessa de confidencialidade do protocolo:
 *         para o contrato recomputar o digest EIP-712, amount e txid iam em
 *         CLARO no calldata de attest() - publico e permanente - e o amount
 *         ainda era emitido no evento. Como a tag e a mesma que o circuito de
 *         liquidacao expoe, qualquer observador ligava VALOR a LIQUIDACAO.
 *
 *         A v2 assinava sobre o commitment da cobranca:
 *             Receipt(bytes32 c0, bytes32 tag, bool settled, uint64 deadline)
 *         onde c0 = Poseidon(amount, salt0, txid) e registrado na criacao da
 *         cobranca. Nada de valor ou identificador aparece on-chain, e o
 *         protocolo GANHA uma checagem que antes nao existia: o PSP recomputa c0
 *         com o valor que de fato liquidou, entao uma divergencia de valor
 *         produz um c0 diferente e a liquidacao nao fecha - consistencia de
 *         valor sem revelar valor.
 *
 *         A v3 (achado A1 da revisao de Marco Tulio Rocha Nascimento) acrescenta
 *         partyCommitment ao recibo. O circuito ja expunha pc = Poseidon(party,
 *         partySalt) como sinal publico (eq. 7), mas nada atestava que aquele pc
 *         era a contraparte que DE FATO pagou - o abstract e o Sec.5 do paper
 *         afirmavam "PSP-attested counterparty commitment" antes de o artefato
 *         sustentar isso. Agora o PSP recomputa pc a partir do identificador do
 *         devedor na mensagem de pagamento (mesma logica de recomputar c0 a
 *         partir do valor), e o finalize (SettlementV2) cross-checa contra o pc
 *         que a prova ZK abre. Sem isso os predicados de compliance do Sec.5
 *         falam de uma contraparte que o prover escolheu, nao a que pagou.
 *
 *         deadline limita a janela de uso de um recibo assinado, contendo o
 *         dano de uma chave de PSP comprometida.
 *
 *         Liquidar no SPI nao e o fim da historia: ha devolucao, mecanismo
 *         especial de devolucao e bloqueio cautelar no PSP recebedor. Por isso
 *         settled=true significa aqui "credito disponivel ao recebedor" e a
 *         atestacao so vira irrevogavel depois de disputeWindow; dentro da
 *         janela o proprio atestador pode registrar attestReversal.
 */
contract SettlementAttestationOracle is EIP712, Ownable {
    bytes32 private constant _RECEIPT_TYPEHASH = keccak256(
        "Receipt(bytes32 c0,bytes32 tag,bytes32 partyCommitment,bool settled,uint64 deadline)"
    );

    bytes32 private constant _REVERSAL_TYPEHASH =
        keccak256("Reversal(bytes32 tag,bool returned,uint64 deadline)");

    /// @notice Recibo do PSP. Liga a cobranca (c0) e a contraparte (partyCommitment)
    ///         ao pagamento liquidado (tag).
    /// @dev Sem amount, sem txid e sem o identificador em claro do devedor: os
    ///      dois primeiros vivem dentro de c0, o terceiro dentro de
    ///      partyCommitment = Poseidon(party, partySalt).
    struct Receipt {
        bytes32 c0; // commitment da cobranca: Poseidon(amount, salt0, txid)
        bytes32 tag; // tag de liquidacao com chave, igual a do circuito
        bytes32 partyCommitment; // Poseidon(party, partySalt) - contraparte atestada
        bool settled; // credito disponivel ao recebedor
        uint64 deadline; // validade do recibo (unix seconds)
    }

    /// @notice Registro de devolucao sobre uma atestacao ja feita.
    struct Reversal {
        bytes32 tag;
        bool returned;
        uint64 deadline;
    }

    /// @dev binding = keccak256(abi.encodePacked(c0, partyCommitment)). Guardar o
    ///      par assim em vez de dois campos bytes32 separados mantem o custo de
    ///      armazenamento igual ao da v2 (mesmo slot extra de sempre) em vez dos
    ///      22,1 mil gas de um slot novo - o finalize recomputa o mesmo hash a
    ///      partir dos sinais publicos da prova e compara.
    struct Attestation {
        address attestor;
        uint64 at;
        bytes32 binding;
        bool reversed;
    }

    /// @notice attestor registrado (chave do PSP) -> confiavel para NOVAS atestacoes
    mapping(address => bool) public attestors;

    /// @notice tag -> atestacao registrada
    mapping(bytes32 => Attestation) private _attestations;

    /// @notice Janela em que a atestacao ainda pode ser revertida.
    uint64 public disputeWindow;

    event AttestorSet(address indexed attestor, bool trusted);
    event DisputeWindowSet(uint64 window);

    /// @dev Sem amount, sem txid e sem o identificador em claro da contraparte -
    ///      o evento nao pode ser o vazamento que o calldata deixou de ser.
    event ReceiptAttested(address indexed attestor, bytes32 indexed tag, bytes32 binding, uint64 at);
    event AttestationReversed(address indexed attestor, bytes32 indexed tag, uint64 at);

    /// @param owner Em producao deve ser um multisig com timelock: um owner
    ///        unipessoal que cadastra atestadores e, sozinho, um ponto de
    ///        confianca tao forte quanto o proprio PSP.
    /// @dev Version "3": o struct do recibo mudou (partyCommitment), entao o
    ///      typehash e o digest EIP-712 ja seriam outros de qualquer forma;
    ///      subir a version string evita que uma carteira/ferramenta confunda
    ///      um recibo v3 com um v2 pelo nome do dominio. Efeito colateral
    ///      aceito: assinaturas de Reversal da v2 tambem deixam de valer, ja
    ///      que Reversal vive no mesmo dominio EIP-712 do Receipt.
    constructor(address owner, uint64 window) EIP712("SettlementAttestationOracle", "3") Ownable(owner) {
        disputeWindow = window;
        emit DisputeWindowSet(window);
    }

    function setAttestor(address attestor, bool trusted) external onlyOwner {
        require(attestor != address(0), "oracle: attestor zero");
        attestors[attestor] = trusted;
        emit AttestorSet(attestor, trusted);
    }

    /// @notice Revogar um atestador bloqueia NOVAS atestacoes e nao invalida as
    ///         passadas: elas ficam registradas com timestamp, e a validade de
    ///         uma atestacao e julgada pelo estado do atestador no momento em
    ///         que foi feita. Invalidar retroativamente daria ao owner o poder
    ///         de desfazer liquidacoes ja concluidas.
    function revokeAttestor(address attestor) external onlyOwner {
        attestors[attestor] = false;
        emit AttestorSet(attestor, false);
    }

    function setDisputeWindow(uint64 window) external onlyOwner {
        disputeWindow = window;
        emit DisputeWindowSet(window);
    }

    /// @notice Submete um recibo assinado por um PSP registrado.
    /// @dev O PSP deve recomputar c0 e partyCommitment ele mesmo - nunca ecoar
    ///      valores vindos do cliente (P8.3 da revisao). Isso e um requisito do
    ///      servico assinador off-chain do PSP; o contrato so verifica a
    ///      assinatura, nao pode verificar de onde vieram os campos assinados.
    function attest(Receipt calldata r, bytes calldata signature) external {
        require(r.settled, "oracle: nao liquidado");
        require(block.timestamp <= r.deadline, "oracle: recibo expirado");
        require(_attestations[r.tag].attestor == address(0), "oracle: tag ja atestada");

        bytes32 structHash = keccak256(
            abi.encode(_RECEIPT_TYPEHASH, r.c0, r.tag, r.partyCommitment, r.settled, r.deadline)
        );
        address signer = ECDSA.recover(_hashTypedDataV4(structHash), signature);
        require(attestors[signer], "oracle: assinante nao e attestor");

        bytes32 binding = keccak256(abi.encodePacked(r.c0, r.partyCommitment));
        _attestations[r.tag] =
            Attestation({attestor: signer, at: uint64(block.timestamp), binding: binding, reversed: false});

        emit ReceiptAttested(signer, r.tag, binding, uint64(block.timestamp));
    }

    /// @notice Registra devolucao dentro da janela de disputa. So o proprio
    ///         atestador que assinou a liquidacao pode reverte-la.
    function attestReversal(Reversal calldata rev, bytes calldata signature) external {
        require(rev.returned, "oracle: reversal sem returned");
        require(block.timestamp <= rev.deadline, "oracle: reversal expirado");

        Attestation storage a = _attestations[rev.tag];
        require(a.attestor != address(0), "oracle: tag nao atestada");
        require(!a.reversed, "oracle: ja revertida");
        require(block.timestamp < a.at + disputeWindow, "oracle: janela encerrada");

        bytes32 structHash = keccak256(abi.encode(_REVERSAL_TYPEHASH, rev.tag, rev.returned, rev.deadline));
        address signer = ECDSA.recover(_hashTypedDataV4(structHash), signature);
        require(signer == a.attestor, "oracle: reversal de outro attestor");

        a.reversed = true;
        emit AttestationReversed(signer, rev.tag, uint64(block.timestamp));
    }

    /// @notice A tag foi atestada como liquidada e nao revertida?
    function isAttested(bytes32 tag) external view returns (bool) {
        Attestation storage a = _attestations[tag];
        return a.attestor != address(0) && !a.reversed;
    }

    /// @notice Passou a janela de devolucao sem reversao: a liquidacao e final.
    ///         E este predicado - nao isAttested - que um DvP deve exigir antes
    ///         de liberar o ativo de forma irreversivel.
    function isIrrevocable(bytes32 tag) external view returns (bool) {
        Attestation storage a = _attestations[tag];
        return a.attestor != address(0) && !a.reversed && block.timestamp >= a.at + disputeWindow;
    }

    /// @notice binding = keccak256(c0, partyCommitment) ligado a esta tag
    ///         (usado pela liquidacao para checar que a prova ZK abre o MESMO
    ///         par (c0, partyCommitment) que o PSP assinou).
    function bindingOf(bytes32 tag) external view returns (bytes32) {
        return _attestations[tag].binding;
    }

    function attestorOf(bytes32 tag) external view returns (address) {
        return _attestations[tag].attestor;
    }

    function attestedAt(bytes32 tag) external view returns (uint64) {
        return _attestations[tag].at;
    }

    function isReversed(bytes32 tag) external view returns (bool) {
        return _attestations[tag].reversed;
    }
}
