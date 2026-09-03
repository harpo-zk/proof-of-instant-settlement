pragma circom 2.2.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

/*
 * Variante do settlement_verify_v2 com os sinais publicos declarados como
 * OUTPUT em vez de input-com-igualdade.
 *
 * Motivo: o Ecne julga "well-determined" comparando quantas VARIAVEIS-ALVO
 * ficaram unicamente determinadas com o total de alvos, e os alvos sao as
 * saidas publicas do r1cs. No estilo `signal input c; ... c === h.out;` o r1cs
 * tem nPubOut = 0, o conjunto-alvo e vazio e o veredito "has sound constraints"
 * e satisfeito VACUAMENTE (0 == 0) — sem que a ferramenta tenha demonstrado
 * nada. Declarando as saidas, o Ecne passa a ter alvos reais.
 *
 * Semanticamente equivalente para Groth16: saidas publicas sao sinais publicos.
 */
template SettlementVerifyV2Out() {
    signal input amount;
    signal input salt0;
    signal input salt;
    signal input e2eId;
    signal input txid;
    signal input k;
    signal input party;
    signal input partySalt;

    signal output c0;
    signal output c;
    signal output nu;
    signal output K;
    signal output partyCommitment;

    component h0 = Poseidon(3);
    h0.inputs[0] <== amount;
    h0.inputs[1] <== salt0;
    h0.inputs[2] <== txid;
    c0 <== h0.out;

    component hc = Poseidon(4);
    hc.inputs[0] <== amount;
    hc.inputs[1] <== salt;
    hc.inputs[2] <== e2eId;
    hc.inputs[3] <== txid;
    c <== hc.out;

    component hn = Poseidon(2);
    hn.inputs[0] <== e2eId;
    hn.inputs[1] <== k;
    nu <== hn.out;

    component hk = Poseidon(1);
    hk.inputs[0] <== k;
    K <== hk.out;

    component hp = Poseidon(2);
    hp.inputs[0] <== party;
    hp.inputs[1] <== partySalt;
    partyCommitment <== hp.out;
}

component main = SettlementVerifyV2Out();
