pragma circom 2.2.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

/*
 * Prova que o listener detectou um PIX cujo (amount, e2eId, txid) corresponde
 * ao commitment registrado on-chain no setup da operacao, sem revelar
 * amount, e2eId ou txid em texto claro.
 *
 * Privados (witness):
 *   - amount  : valor do PIX (uint64 / centavos, encodado como field element)
 *   - salt    : salt aleatorio de 256 bits gerado no setup
 *   - e2eId   : EndToEndId do PIX, convertido para field element off-chain
 *               (ex: keccak256(stringE2eId) mod p)
 *   - txid    : identificador da cobranca (txid do BR Code / Pix Copia e Cola)
 *               trocado via mensagem privada Harpo entre IF Recebedora e IF
 *               Pagadora no passo anterior; amarra a prova aquela cobranca
 *               especifica, nao apenas a um (amount, e2eId) coincidente.
 *
 * Publicos:
 *   - commitment : valor registrado on-chain pelo orchestrator no setup
 *                  da operacao; deve ser igual a Poseidon(amount, salt, e2eId, txid)
 *   - e2eIdHash  : Poseidon(e2eId); usado on-chain para anti-replay
 */
template PixPaymentVerify() {
    signal input amount;
    signal input salt;
    signal input e2eId;
    signal input txid;

    signal input commitment;
    signal input e2eIdHash;

    // Constraint 1: (amount, salt, e2eId, txid) bate com o commitment registrado
    component hCommit = Poseidon(4);
    hCommit.inputs[0] <== amount;
    hCommit.inputs[1] <== salt;
    hCommit.inputs[2] <== e2eId;
    hCommit.inputs[3] <== txid;
    commitment === hCommit.out;

    // Constraint 2: o e2eIdHash publico realmente corresponde ao e2eId privado
    component hE2E = Poseidon(1);
    hE2E.inputs[0] <== e2eId;
    e2eIdHash === hE2E.out;
}

component main {public [commitment, e2eIdHash]} = PixPaymentVerify();
