pragma circom 2.2.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

/*
 * settlement_verify_v2 — liquidacao instantanea com ancoragem em duas fases.
 *
 * Responde a tres achados da revisao do manuscrito:
 *
 *  (C4) O commitment antigo c = Poseidon(amount, salt, e2eId, txid) so e
 *       computavel DEPOIS do pagamento, porque o e2eId nasce ali. Isso deixa o
 *       escrow do ativo sem ancora no momento em que os termos sao acordados e
 *       inviabiliza DvP atomico. Introduzimos a fase 0:
 *           c0 = Poseidon(amount, salt0, txid)
 *       registrada na CRIACAO DA COBRANCA. O circuito prova que o mesmo
 *       (amount, txid) aparece em c0 e em c — ligando os termos acordados a
 *       liquidacao efetiva, sem revelar nenhum dos dois.
 *
 *  (C2-iii) A chave de dominio k nao tinha ancora on-chain: o PSP virava
 *       custodiante dela e a unicidade do tag valia apenas "por dominio, se
 *       todos usarem o mesmo k". Expomos K = Poseidon(k) como sinal PUBLICO,
 *       registrado no setup do dominio. A unicidade intra-dominio passa a valer
 *       por construcao: dois tags sob o mesmo K vem do mesmo k.
 *
 *  (C6) A contraparte usada nos predicados de sancoes/KYC era escolhida pelo
 *       provador e nada a ligava a operacao — uma instituicao maliciosa
 *       commitava a qualquer identidade limpa. O partyCommitment passa a ser
 *       sinal publico deste circuito e e atestado pelo PSP (CPF/CNPJ do devedor
 *       tal como consta na mensagem de pagamento), de modo que os predicados
 *       consomem a MESMA contraparte que liquidou.
 *
 * Privados : amount, salt0, salt, e2eId, txid, k, party, partySalt
 * Publicos : c0, c, nu, K, partyCommitment
 *
 * Nota: salt0 e compartilhado com o PSP na criacao da cobranca, para que ele
 * possa recomputar c0 com o valor que de fato liquidou e assinar o recibo sobre
 * c0 — o que da consistencia de valor sem que o valor apareca em lugar nenhum.
 */
template SettlementVerifyV2() {
    // --- privados ---
    signal input amount;      // valor em centavos
    signal input salt0;       // blinding da fase 0 (compartilhado com o PSP)
    signal input salt;        // blinding da liquidacao
    signal input e2eId;       // identificador do pagamento, como field element
    signal input txid;        // identificador da cobranca no PSP
    signal input k;           // chave de dominio (tag com chave)
    signal input party;       // contraparte (CPF/CNPJ) como field element
    signal input partySalt;   // blinding da contraparte

    // --- publicos ---
    signal input c0;              // commitment da cobranca (fase 0)
    signal input c;               // commitment da liquidacao
    signal input nu;              // tag de liquidacao com chave (anti-replay)
    signal input K;               // ancora on-chain da chave de dominio
    signal input partyCommitment; // contraparte atestada pelo PSP

    // (1) fase 0: os termos acordados, registrados antes do pagamento existir
    component h0 = Poseidon(3);
    h0.inputs[0] <== amount;
    h0.inputs[1] <== salt0;
    h0.inputs[2] <== txid;
    c0 === h0.out;

    // (2) liquidacao: mesmo amount e mesmo txid da fase 0, agora com o e2eId
    component hc = Poseidon(4);
    hc.inputs[0] <== amount;
    hc.inputs[1] <== salt;
    hc.inputs[2] <== e2eId;
    hc.inputs[3] <== txid;
    c === hc.out;

    // (3) tag com chave: deterministico em e2eId, mas nao invertivel sem k
    component hn = Poseidon(2);
    hn.inputs[0] <== e2eId;
    hn.inputs[1] <== k;
    nu === hn.out;

    // (4) ancora da chave de dominio: prova que nu usou o k registrado on-chain
    component hk = Poseidon(1);
    hk.inputs[0] <== k;
    K === hk.out;

    // (5) contraparte: a mesma que os predicados de compliance consomem
    component hp = Poseidon(2);
    hp.inputs[0] <== party;
    hp.inputs[1] <== partySalt;
    partyCommitment === hp.out;
}

component main {public [c0, c, nu, K, partyCommitment]} = SettlementVerifyV2();
