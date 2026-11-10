# Disparador WhatsApp — Dra. Daiana Ferraz

Reativação de pacientes por WhatsApp com deduplicação (telefone + mês), blacklist (opt-out),
teto de **48 envios por número a cada 24h** e exportação Customer Match (Google Ads).

## Como usar

Duplo clique em **`iniciar.bat`** (ou `.\iniciar.ps1` no PowerShell). Na primeira vez ele roda `npm install`.

O menu tem 5 áreas, e cada uma mostra "o que você pode verificar aqui":

| Área | Para que serve |
|---|---|
| **[A] O que fazer agora** | Checklist do dia: zaps sem conexão, campanha terminada, falhas, erros |
| **[1] Enviar** | Modo contínuo (envia e **encerra sozinho ao concluir**), painel no navegador, status, envio manual, simulação |
| **[2] Campanha** | Gerar lista, fechamento (chegou a 100%?), retentar falhas, convite de grupo, Customer Match |
| **[3] Zaps** | Números e saldo 24h, conectar por QR, testar, desconectar, atualizar biblioteca |
| **[4] Gestão** | Relatório TPM (KPIs, riscos) e log de erros |
| **[5] Manutenção** | Blacklist, números sem WhatsApp, limpar histórico |

Rotina diária resumida: `[A]` → `[1]` → `1` (modo contínuo). Quando terminar: `[2]` → `1` (nova lista).

## Criar campanha com a mensagem que você quiser (painel)

Menu `[1] Enviar` → `[2] Painel` → aba **Nova campanha**:

1. **Mensagem**: editor com negrito/itálico/tachado, emojis e variáveis `{nome}`, `{saudacao}`, `{data}`.
   A prévia mostra como fica no WhatsApp, com um contato real de exemplo. Sem nome no contato, a saudação fica sem nome.
2. **Público**: contatos filtrados (por DDD e busca), escolha um a um, ou colar uma lista de números.
   Blacklist, quem já recebeu no mês e números inválidos são removidos automaticamente (o painel mostra quantos).
3. **Quando**: iniciar agora, agendar data/hora, ou só salvar a lista.

A campanha vira um arquivo em `dados/listas/` e aparece em Campanhas/Fechamento como as demais.
Agendamentos ficam em `config/agendamentos.json` e são disparados pelo painel: **o painel precisa estar aberto
e o computador ligado** no horário. Se já houver envio rodando, a campanha agendada espera ele terminar.
Só texto (sem imagem/anexo) e sem segmentação por perfil: o público é definido por DDD/busca, seleção manual ou números colados.

### Lotes diários

Com **4 números × 48 = 192 envios por dia**, toda campanha é dividida em **lotes diários** de até 192 contatos (coluna `lote` da lista). Cada número envia até 48 e espera a janela de 24h liberar para continuar; o modo contínuo segue sozinho até o último lote e então encerra. O painel mostra, antes de criar, quantos lotes e dias vão levar, e em Campanhas mostra o lote atual e o progresso de cada lote. Campanhas que atravessam a virada do mês não reenviam para quem já foi processado.

## CRM da clínica (painel, para quem não é técnico)

Tudo editável no navegador, sem mexer em arquivos. Abas do painel:

| Aba | O que você faz |
|---|---|
| **Clínica** | Nome, assinatura, Instagram, rodapé "responda SAIR" e as **unidades** (cidade, endereço, link do Google Maps, link de avaliação no Google, DDDs atendidos). Contatos recebem os dados da unidade do seu DDD. Para informar/trocar o WhatsApp: Operação › Conectar (QR). |
| **Preços** | Tabela de procedimentos e valores. |
| **Promoções** | Promoções por trimestre (3 meses): desconto % ou preço promocional por procedimento, com validade. O preço com desconto é calculado a partir da tabela. |
| **Calendário** | Por trimestre: datas comemorativas (Mulher, Saúde Bucal, Páscoa, Mães, Namorados, Pais, Cliente, Crianças, Dentista, Black Friday, Natal, Ano Novo). "Montar plano" sugere um envio por data; escolha modelo, promoção e unidade e **Aprovar**. O envio acontece sozinho na data/hora (painel aberto), criando a lista na hora com preços e links atuais. |
| **Mensagens** | Biblioteca de modelos prontos: datas, apresentar procedimento, localização (Maps), Instagram, pedir avaliação no Google, aniversário, retorno, boas-vindas, orçamento. Edite, duplique ou crie novos, com prévia. |
| **Nova campanha** | Escolha um modelo, unidade, promoção e público e envie agora ou agende. |

Variáveis: `{nome} {saudacao} {data} {clinica} {assinatura} {sair} {instagram} {cidade} {uf} {endereco} {maps} {avaliacao} {procedimento} {promocao} {lista_promocoes} {validade} {desconto} {preco} {preco_promo}`.
O painel avisa se faltar algum link (ex.: unidade sem Google Maps) ou se a variável não existir.

> **Publicidade odontológica (CFO/CRO):** o Código de Ética Odontológica restringe divulgar **preços, descontos, serviços
> gratuitos e condições de pagamento**. O sistema permite, mas **exige confirmação** quando a mensagem tiver isso. Não é
> orientação jurídica: confirme as regras vigentes com o seu CRO antes de usar promoções com valores.
> Também mantenha o "responda SAIR" e registre quem pedir saída em `dados/entrada/blacklist.txt` (LGPD).

Limite de proteção: cada telefone recebe no máximo 1 mensagem por mês. Se o calendário tiver duas ações no mesmo mês, a segunda só alcança quem ainda não recebeu.

## Zaps identificados pelo número

Cada zap aparece pelo **número** (`+55 16 99721-2966`). Se o número ainda não foi conectado, aparece como
`Zap 3 (vazio)`. O número é gravado automaticamente ao ler o QR. Nomes úteis (ex.: "wes trabalho") ficam
em `config/chips.json` (campo `apelido`); deixe `""` para mostrar só o número.

## Estrutura

```
iniciar.bat / iniciar.ps1   menu principal
src/                        código (sender, zap_core, gestao, painel, campanhas, crm, gerar_lista.py, customer_match.py)
config/                     chips.json (zaps), clinica/precos/promocoes/modelos/plano.json (CRM, criados ao salvar), agendamentos.json
dados/entrada/              contacts.csv, blacklist.txt, informacoescliente.txt, mensagens
dados/listas/               listas geradas para envio (CSV)
dados/publico/              exportações Customer Match
logs/                       sent_log.json (histórico — NÃO apagar), run_*.json, erros/
sessoes/                    sessões do WhatsApp (QR já lido) — NÃO apagar
ferramentas/                scripts avulsos (extrair grupos, priorizar Pato Branco)
docs/                       OPERACAO_SECRETARIA.md e GESTAO_TPM.md
tests/                      npm test
```

## Linha de comando (opcional)

```
npm run continuo     modo contínuo       npm run simular   dry-run
npm run status       progresso           npm run hoje      checklist
npm run painel       http://localhost:3737    npm test
```

## Regras

- 48 envios/número/24h (limite 50 − margem 2, ajustável em `config/chips.json`).
- Telefone + mês: quem já recebeu no mês não entra de novo. Blacklist é checada no momento do envio.
- Zap desconectado ou em quarentena é ignorado; 2 falhas de conexão seguidas = quarentena de 6h.
- Modo contínuo encerra quando a campanha termina e não usa listas de meses anteriores.

Requisitos: Node.js 18+, Python 3.10+ (só biblioteca padrão), PowerShell 5.1+.
