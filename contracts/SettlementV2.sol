// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/**
 * @title SettlementV2 - composicao do protocolo de liquidacao
 * @notice Junta as pecas que o manuscrito descreve, para que a liquidacao
 *         seja uma transacao real e nao apenas uma chamada isolada ao verifier:
 *
 *           1. o escrow trava no commitment da cobranca c0, registrado ANTES de
 *              o pagamento existir (fase 0), com um prazo;
 *           2. o oraculo atesta que o PSP assinou um recibo sobre AQUELE c0;
 *           3. a prova Groth16 abre os dois commitments provando os mesmos
 *              (amount, txid), sem revelar nenhum deles.
 *
 *         O contrato compara o c0 do escrow com o c0 que o PSP assinou e com o
 *         c0 que a prova abre. Os tres precisam coincidir. Uma liquidacao de
 *         valor divergente produz outro c0 e nao fecha - consistencia de valor
 *         sem o valor aparecer. A mesma logica vale para a contraparte: o PSP
 *         assina tambem partyCommitment, e o finalize exige que o par (c0,
 *         partyCommitment) atestado coincida com o que a prova abre - sem isso
 *         o sinal publico partyCommitment do circuito e decorativo, o prover
 *         escolhe a contraparte que quiser.
 *
 *         Liveness (achado H1 da revisao): sem um prazo, um PSP que nunca
 *         assina trava a operacao para sempre em Locked. cancel() da a
 *         qualquer operacao travada uma saida apos o deadline informado em
 *         lock(), sem depender do PSP. finalize() e cancel() sao ambas
 *         transicoes validas a partir de Locked e mutuamente exclusivas -
 *         qualquer uma que chegar primeiro consome o estado, entao nao ha
 *         janela em que a mesma operacao possa fechar E expirar. Este
 *         contrato nao guarda nem move nenhum ativo (ver NatSpec de
 *         isReleasable); um escrow de ativo real, construido por cima,
 *         e quem decide para quem devolver ao observar Expired, usando o
 *         beneficiario que ELE mesmo guardou no seu proprio lock - nao quem
 *         chamou cancel() aqui, que e deliberadamente permissionless.
 */

interface ISettlementVerifierV2 {
    function verifyProof(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[5] calldata pubSignals
    ) external view returns (bool);
}

interface ISettlementAttestationOracle {
    function isAttested(bytes32 tag) external view returns (bool);
    function isIrrevocable(bytes32 tag) external view returns (bool);
    function bindingOf(bytes32 tag) external view returns (bytes32);
}

contract SettlementV2 {
    enum State { None, Locked, Finalized, Expired }

    struct Operation {
        bytes32 c0; // commitment da cobranca (fase 0)
        bytes32 c; // commitment da liquidacao
        bytes32 tag; // tag de liquidacao com chave
        State state;
        uint64 deadline; // apos este timestamp, Locked pode virar Expired
    }

    ISettlementVerifierV2 public immutable verifier;
    ISettlementAttestationOracle public immutable oracle;

    /// @notice Ancora on-chain da chave de dominio: K = Poseidon(k).
    bytes32 public immutable domainKeyAnchor;

    /// @notice c0 -> operacao
    mapping(bytes32 => Operation) private _ops;

    /// @notice tag -> ja usada (anti-replay no ponto de liquidacao)
    mapping(bytes32 => bool) public tagUsed;

    event OperationLocked(bytes32 indexed c0, uint64 deadline);
    event OperationFinalized(bytes32 indexed c0, bytes32 indexed tag, bytes32 c);
    event OperationExpired(bytes32 indexed c0);

    constructor(address _verifier, address _oracle, bytes32 _domainKeyAnchor) {
        verifier = ISettlementVerifierV2(_verifier);
        oracle = ISettlementAttestationOracle(_oracle);
        domainKeyAnchor = _domainKeyAnchor;
    }

    /// @notice Fase 0: registra os termos acordados. O ativo trava aqui, antes
    ///         de existir qualquer pagamento. `deadline` e o prazo apos o qual,
    ///         se o PSP nunca assinar, cancel() destrava a operacao.
    function lock(bytes32 c0, uint64 deadline) external {
        require(c0 != bytes32(0), "settlement: c0 zero");
        require(_ops[c0].state == State.None, "settlement: ja registrada");
        require(deadline > block.timestamp, "settlement: deadline no passado");
        _ops[c0] = Operation({
            c0: c0,
            c: bytes32(0),
            tag: bytes32(0),
            state: State.Locked,
            deadline: deadline
        });
        emit OperationLocked(c0, deadline);
    }

    /// @notice Saida de liveness: se o PSP nunca assinar e o prazo de lock()
    ///         passar, qualquer um pode marcar a operacao como Expired. Nao
    ///         move nenhum ativo (este contrato nao guarda nenhum); e o sinal
    ///         que um escrow de ativo real, construido por cima, usaria para
    ///         devolver ao beneficiario que ELE registrou. Permissionless por
    ///         desenho, como finalize(): nada de valor se move aqui.
    function cancel(bytes32 c0) external {
        Operation storage op = _ops[c0];
        require(op.state == State.Locked, "settlement: operacao nao travada");
        require(block.timestamp > op.deadline, "settlement: prazo ainda nao expirou");
        op.state = State.Expired;
        emit OperationExpired(c0);
    }

    /// @notice Fase 1: liquida. pubSignals = [c0, c, nu, K, partyCommitment].
    function finalize(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[5] calldata pubSignals
    ) external {
        bytes32 c0 = bytes32(pubSignals[0]);
        bytes32 c = bytes32(pubSignals[1]);
        bytes32 tag = bytes32(pubSignals[2]);
        bytes32 anchor = bytes32(pubSignals[3]);
        bytes32 partyCommitment = bytes32(pubSignals[4]);

        Operation storage op = _ops[c0];
        require(op.state == State.Locked, "settlement: operacao nao travada");
        require(!tagUsed[tag], "settlement: tag ja usada");

        // A prova precisa vir da chave de dominio registrada: sem isso a
        // unicidade da tag valeria apenas por convencao.
        require(anchor == domainKeyAnchor, "settlement: ancora de dominio divergente");

        // O PSP assinou um recibo sobre ESTE (c0, partyCommitment) - e o recibo
        // nao carrega valor nem o identificador em claro da contraparte. Sem
        // este cross-check, partyCommitment e um sinal publico do circuito mas
        // "decorativo": o prover escolhe a contraparte que quiser (achado A1 da
        // revisao). Com ele, os predicados de compliance do Sec.5 falam da
        // contraparte que o PSP viu pagar, por construcao.
        require(oracle.isAttested(tag), "settlement: tag nao atestada");
        require(
            oracle.bindingOf(tag) == keccak256(abi.encodePacked(c0, partyCommitment)),
            "settlement: recibo divergente do escrow (c0 ou contraparte)"
        );

        require(verifier.verifyProof(pA, pB, pC, pubSignals), "settlement: prova invalida");

        tagUsed[tag] = true;
        op.c = c;
        op.tag = tag;
        op.state = State.Finalized;

        emit OperationFinalized(c0, tag, c);
    }

    /// @notice Predicado de liberacao: exige que a janela de devolucao do
    ///         trilho tenha passado sem reversao. Este contrato nao guarda
    ///         nenhum ativo - `isReleasable`/`Expired` sao os dois predicados
    ///         que um escrow de ativo real, construido por cima, consultaria
    ///         para decidir se libera (para o beneficiario) ou devolve (para
    ///         quem pagou), cada um usando o endereco que ELE mesmo guardou.
    function isReleasable(bytes32 c0) external view returns (bool) {
        Operation storage op = _ops[c0];
        return op.state == State.Finalized && oracle.isIrrevocable(op.tag);
    }

    /// @notice True apos cancel() ter sido chamado com sucesso para este c0.
    function isExpired(bytes32 c0) external view returns (bool) {
        return _ops[c0].state == State.Expired;
    }

    function getOperation(bytes32 c0) external view returns (Operation memory) {
        return _ops[c0];
    }
}
