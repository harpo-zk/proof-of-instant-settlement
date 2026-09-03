pragma circom 2.2.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/smt/smtverifier.circom";

/*
 * COMPLIANCE SEM DISCLOSURE — fase 2: NÃO-PERTENCIMENTO A LISTA DE SANÇÕES.
 *
 * O regulador quer saber "a contraparte desta transação NÃO está na lista de
 * sanções?" SEM revelar quem é a contraparte. A lista de sanções é uma Sparse
 * Merkle Tree (SMT) cujo root é público; a instituição prova, em zero-knowledge,
 * que a `party` comprometida em `commitment` NÃO pertence à SMT (prova de
 * exclusão do circomlib SMTVerifier com fnc=1), sem revelar a party.
 *
 * Privados: party, salt, e a prova de exclusão da SMT (siblings, oldKey,
 *           oldValue, isOld0).
 * Públicos: commitment = Poseidon(party, salt) (amarra à tx), sanctionsRoot.
 *
 * Uma prova válida ⇔ a party comprometida não está na lista de sanções `root`.
 * Se a party ESTIVER na lista, não existe prova de exclusão — impossível provar.
 */
template SanctionsExclusionVerify(nLevels) {
    // privados
    signal input party;
    signal input salt;

    // prova de exclusão da SMT (witness)
    signal input siblings[nLevels];
    signal input oldKey;
    signal input oldValue;
    signal input isOld0;

    // públicos
    signal input commitment;
    signal input sanctionsRoot;

    // 1) Amarra a party à transação comprometida.
    component hc = Poseidon(2);
    hc.inputs[0] <== party;
    hc.inputs[1] <== salt;
    commitment === hc.out;

    // 2) Prova de EXCLUSÃO: party ∉ SMT(sanctionsRoot). fnc=1 = non-membership.
    component smt = SMTVerifier(nLevels);
    smt.enabled <== 1;
    smt.fnc <== 1;
    smt.root <== sanctionsRoot;
    for (var i = 0; i < nLevels; i++) {
        smt.siblings[i] <== siblings[i];
    }
    smt.oldKey <== oldKey;
    smt.oldValue <== oldValue;
    smt.isOld0 <== isOld0;
    smt.key <== party;
    smt.value <== 0;
}

component main {public [commitment, sanctionsRoot]} = SanctionsExclusionVerify(16);
