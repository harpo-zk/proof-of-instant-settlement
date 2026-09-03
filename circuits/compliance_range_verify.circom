pragma circom 2.2.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

/*
 * COMPLIANCE SEM DISCLOSURE — prova de predicado ZK (§3 do Auditor Público Restrito).
 *
 * O regulador quer saber "o valor desta transação respeita o limite de política?"
 * SEM ver o valor e SEM gastar cota de auditoria. A instituição prova que o
 * `amount` comprometido em `commitment` é MENOR que um `limit` público — um
 * "compliant: sim" verificável, sem revelar nada além do próprio fato.
 *
 * Reusa o MESMO commitment do fluxo Pix (Poseidon(amount, salt, e2eId, txid)),
 * então a mesma transação liquidada pode ser atestada como compliant.
 *
 * Privados (witness): amount, salt, e2eId, txid  (a abertura do commitment)
 * Públicos:           commitment (amarra à tx), limit (a política)
 *
 * Uma prova válida ⇔ existe uma abertura de `commitment` cujo `amount < limit`.
 * O `amount` real nunca vaza; só o predicado.
 */
template ComplianceRangeVerify() {
    signal input amount;
    signal input salt;
    signal input e2eId;
    signal input txid;

    signal input commitment; // público — amarra a prova a uma tx específica
    signal input limit;      // público — o limite de política (em centavos)

    // 1) Conhece a abertura do commitment registrado (mesmo esquema do Pix).
    component hCommit = Poseidon(4);
    hCommit.inputs[0] <== amount;
    hCommit.inputs[1] <== salt;
    hCommit.inputs[2] <== e2eId;
    hCommit.inputs[3] <== txid;
    commitment === hCommit.out;

    // 2) Soundness do comparador: amount cabe em 64 bits (impede wrap no campo).
    component ab = Num2Bits(64);
    ab.in <== amount;

    // 2b) RT-12 / circomspect: o `limit` TAMBÉM precisa caber em 64 bits. Sem isto, um
    //     limit >= 2^64 quebra a soundness do LessThan(64) (o comparador só é válido quando
    //     ambas as entradas são < 2^64). O circomspect flagou exatamente este input.
    component lb = Num2Bits(64);
    lb.in <== limit;

    // 3) O PREDICADO: amount < limit  (compliant se verdadeiro).
    component lt = LessThan(64);
    lt.in[0] <== amount;
    lt.in[1] <== limit;
    lt.out === 1;
}

component main {public [commitment, limit]} = ComplianceRangeVerify();
