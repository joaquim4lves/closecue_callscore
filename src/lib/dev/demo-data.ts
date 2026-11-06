export const DEMO = {
  orgId: "11111111-1111-4111-8111-111111111111",
  managerId: "22222222-2222-4222-8222-222222222222",
  sellerId: "33333333-3333-4333-8333-333333333333",
  playbookId: "44444444-4444-4444-8444-444444444444",
  orgName: "Demo Workspace",
  manager: { email: "manager@demo.closecue.local", name: "Marina Gestor" },
  seller: { email: "seller@demo.closecue.local", name: "Lucas Vendedor" },
  playbookName: "Outbound B2B",
} as const;

export const DEMO_PHASES = [
  {
    id: "55555555-5555-4555-8555-555555555501",
    sortOrder: 0,
    name: "Abertura",
    triggerText: "Início da call, depois da saudação",
    script:
      "Obrigado pelo tempo. Em vinte minutos quero entender o processo de vocês e ver se faz sentido seguir.",
    checklistItems: ["Confirmar agenda e participantes", "Dizer o objetivo da call", "Pedir permissão para anotar"],
  },
  {
    id: "55555555-5555-4555-8555-555555555502",
    sortOrder: 1,
    name: "Descoberta",
    triggerText: "Cliente descreve o cenário atual",
    script: "Como vocês fazem isso hoje, e onde dói mais no time?",
    checklistItems: ["Situação atual", "Impacto em tempo ou receita", "Quem decide"],
  },
  {
    id: "55555555-5555-4555-8555-555555555503",
    sortOrder: 2,
    name: "Proposta",
    triggerText: "A dor já está clara",
    script: "Pelo que você descreveu, o caminho é este. O próximo passo concreto seria um piloto curto.",
    checklistItems: ["Ligar a dor à proposta", "Preço só depois do valor", "Confirmar entendimento"],
  },
  {
    id: "55555555-5555-4555-8555-555555555504",
    sortOrder: 3,
    name: "Objeções",
    triggerText: "Cliente levanta preço, timing ou confiança",
    script: "Deixa eu tratar isso direto antes de seguir.",
    checklistItems: ["Nomear a objeção", "Responder com uma prova", "Checar se ficou resolvida"],
  },
  {
    id: "55555555-5555-4555-8555-555555555505",
    sortOrder: 4,
    name: "Fechar",
    triggerText: "Objeções tratadas ou o tempo está acabando",
    script: "Para avançar, fechamos o piloto na quinta ou prefere a agenda da semana que vem?",
    checklistItems: ["Pedir uma decisão", "Combinar data e dono", "Recapitular o acordo"],
  },
] as const;

export const DEMO_OBJECTIONS = [
  {
    id: "66666666-6666-4666-8666-666666666601",
    sortOrder: 0,
    label: "Preço",
    signals: ["está caro", "não tenho orçamento", "preciso de desconto"],
    suggestedResponse:
      "O custo fica pequeno perto do tempo que o time perde hoje. Se o piloto mostrar o número, seguimos; se não, paramos.",
  },
  {
    id: "66666666-6666-4666-8666-666666666602",
    sortOrder: 1,
    label: "Confiança",
    signals: ["não conheço vocês", "preciso validar", "manda um case"],
    suggestedResponse:
      "Justo. Te mando um caso do mesmo segmento e um piloto curto com critério de saída.",
  },
  {
    id: "66666666-6666-4666-8666-666666666603",
    sortOrder: 2,
    label: "Já temos fornecedor",
    signals: ["já usamos outra ferramenta", "estamos amarrados no contrato"],
    suggestedResponse:
      "Não precisa trocar agora. O piloto roda em paralelo no ponto que a ferramenta atual não cobre.",
  },
  {
    id: "66666666-6666-4666-8666-666666666604",
    sortOrder: 3,
    label: "Timing",
    signals: ["agora não", "no próximo trimestre", "sem banda"],
    suggestedResponse:
      "Se a dor custa todo mês, esperar também tem preço. Dá para começar com um recorte de duas semanas.",
  },
] as const;
