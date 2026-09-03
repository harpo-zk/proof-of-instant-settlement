pragma circom 2.2.0;
include "../node_modules/circomlib/circuits/poseidon.circom";

// RT-5: substitui o e2eIdHash publico (Poseidon(e2eId), forca-bruteavel) por um
// NULLIFIER COM CHAVE: nullifier = Poseidon(e2eId, nullifierSalt), onde nullifierSalt
// e um segredo compartilhado do dominio. Preserva o anti-replay (deterministico p/
// quem tem o salt) e impede a deanonimizacao (sem o salt, o e2eId nao e recuperavel
// do nullifier — o salt tem ~254 bits de entropia).
template PixNullifierVerify() {
    signal input amount;
    signal input salt;
    signal input e2eId;
    signal input txid;
    signal input nullifierSalt;   // segredo compartilhado do dominio (privado)

    signal input commitment;      // publico
    signal input nullifier;       // publico (keyed anti-replay)

    component hc = Poseidon(4);
    hc.inputs[0] <== amount;
    hc.inputs[1] <== salt;
    hc.inputs[2] <== e2eId;
    hc.inputs[3] <== txid;
    commitment === hc.out;

    component hn = Poseidon(2);
    hn.inputs[0] <== e2eId;
    hn.inputs[1] <== nullifierSalt;
    nullifier === hn.out;
}
component main {public [commitment, nullifier]} = PixNullifierVerify();
