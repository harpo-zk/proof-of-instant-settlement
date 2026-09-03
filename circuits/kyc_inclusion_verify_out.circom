pragma circom 2.2.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/smt/smtverifier.circom";

/*
 * Variante do kyc_inclusion_verify com o commitment derivado declarado como
 * OUTPUT, para que o Ecne tenha uma variavel-alvo real.
 *
 * kycRoot permanece INPUT publico: e a ancora de politica fixada on-chain pela
 * autoridade, nao um valor derivado do witness — declara-la como saida seria
 * incorreto.
 */
template KycInclusionVerifyOut(nLevels) {
    signal input party;
    signal input salt;
    signal input value;

    signal input siblings[nLevels];
    signal input oldKey;
    signal input oldValue;
    signal input isOld0;

    signal input kycRoot;      // ancora de politica (publica, nao derivada)
    signal output commitment;  // derivado: Poseidon(party, salt)

    component hc = Poseidon(2);
    hc.inputs[0] <== party;
    hc.inputs[1] <== salt;
    commitment <== hc.out;

    component smt = SMTVerifier(nLevels);
    smt.enabled <== 1;
    smt.fnc <== 0;
    smt.root <== kycRoot;
    for (var i = 0; i < nLevels; i++) {
        smt.siblings[i] <== siblings[i];
    }
    smt.oldKey <== oldKey;
    smt.oldValue <== oldValue;
    smt.isOld0 <== isOld0;
    smt.key <== party;
    smt.value <== value;
}

component main {public [kycRoot]} = KycInclusionVerifyOut(16);
