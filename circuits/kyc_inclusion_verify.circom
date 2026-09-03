pragma circom 2.2.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/smt/smtverifier.circom";

/*
 * COMPLIANCE SEM DISCLOSURE — fase 3: PERTENCIMENTO À LISTA DE KYC (allowlist).
 *
 * Espelho do sanctions_exclusion: o regulador quer saber "a contraparte desta
 * transação É uma parte KYC-verificada?" SEM revelar quem é a contraparte. A
 * lista de identidades verificadas é uma Sparse Merkle Tree (SMT) cujo root é
 * público; a instituição prova, em zero-knowledge, que a `party` comprometida em
 * `commitment` PERTENCE à SMT (prova de inclusão do circomlib SMTVerifier com
 * fnc=0), sem revelar a party.
 *
 * Junto com o sanctions_exclusion (party ∉ sanções) e o compliance_range
 * (amount < limit), fecha o "compliant: sim" completo — valor, contraparte
 * NÃO-sancionada E contraparte KYC-verificada — tudo sem abrir a transação.
 *
 * Privados: party, salt, value (flag/tier armazenado na folha), e a prova de
 *           inclusão da SMT (siblings).
 * Públicos: commitment = Poseidon(party, salt) (amarra à tx), kycRoot.
 *
 * Uma prova válida ⇔ a party comprometida está na allowlist KYC `root`.
 * Se a party NÃO estiver na lista, não existe prova de inclusão — impossível provar.
 */
template KycInclusionVerify(nLevels) {
    // privados
    signal input party;
    signal input salt;
    signal input value; // valor armazenado na folha (ex.: 1 = verificado, ou um tier)

    // prova de inclusão da SMT (witness); oldKey/oldValue/isOld0 = 0 para fnc=0
    signal input siblings[nLevels];
    signal input oldKey;
    signal input oldValue;
    signal input isOld0;

    // públicos
    signal input commitment;
    signal input kycRoot;

    // 1) Amarra a party à transação comprometida.
    component hc = Poseidon(2);
    hc.inputs[0] <== party;
    hc.inputs[1] <== salt;
    commitment === hc.out;

    // 2) Prova de INCLUSÃO: party ∈ SMT(kycRoot). fnc=0 = membership.
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

component main {public [commitment, kycRoot]} = KycInclusionVerify(16);
