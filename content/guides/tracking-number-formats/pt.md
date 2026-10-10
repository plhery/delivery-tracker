---
title: Como saber qual é a transportadora pelo número de seguimento
description: Descobre que transportadora tem a tua encomenda pelo número de seguimento: como são os números dos CTT, DPD, GLS, InPost, DHL e UPS, e o que dizem as letras.
slug: como-saber-qual-e-a-transportadora
picture: Três etiquetas de seguimento divididas em partes coloridas, uma lupa sobre o código de país CH e o Pip, curioso.
published: 2026-10-09
updated: 2026-10-10
---

As letras e o comprimento de um número de seguimento dizem muitas vezes que transportadora tem a tua encomenda. `1Z` seguido de 16 letras e algarismos é UPS, e 13 caracteres como `RR123456785CH` (duas letras, nove algarismos, duas letras) costumam ser de um operador postal, com o país que emitiu o número nas duas últimas letras: `PT` é Portugal. Os números só com algarismos são o caso difícil: 10, 12 ou 14 algarismos podem ser de várias transportadoras, e aí quem decide é o e-mail de envio, ou um serviço de seguimento que as experimente uma a uma.

:::checker
:::

## Como saber qual é a transportadora da minha encomenda?

Quatro passos, por esta ordem:

:::steps
- Olha para as letras | São a melhor pista. `1Z` no início é UPS; duas letras no fim costumam ser de um operador postal, como os CTT.
- Conta os caracteres | O comprimento raramente decide sozinho, mas põe transportadoras de parte. Não contes os espaços: estão lá só para facilitar a leitura e não fazem parte do número.
- Vê o e-mail | O e-mail ou o SMS de envio da loja costuma dizer qual é a transportadora, ou trazer uma ligação para a página de seguimento dela. Vale mais do que qualquer palpite.
- Experimenta nos sites | Introduz o número no site de cada transportadora possível. A que mostrar leituras desse número é a que tem a tua encomenda.
:::

Se não te apetecer fazer de detetive, cola o número, uma ligação da transportadora ou o e-mail de envio inteiro no [Peek](/): ele encontra o número e deteta a transportadora entre mais de 3500. Os outros serviços que juntam várias transportadoras estão em [como seguir todas as encomendas num só lugar](guide:universal-tracker).

## Como é o número de seguimento de cada transportadora

Eis o que as transportadoras, e a norma postal, dizem sobre os números que mais vais encontrar em Portugal:

| Transportadora | Como é o número |
| --- | --- |
| CTT | os CTT chamam-lhe «código de envio»: normalmente 2 letras, 9 algarismos e 2 letras, como no exemplo `RD123456789PT`; alguns envios têm um número só com algarismos, 22 ou 25 |
| DPD | «número de encomenda» de 14 algarismos; o Track & Trace da DPD também aceita o teu número de referência |
| GLS | «número de encomenda» ou «ID de Rastreamento», que vem em cada cartão de notificação; a GLS não indica o comprimento |
| InPost | «número de expedição»; o exemplo da página de seguimento tem 8 caracteres: `89972378` |
| DHL | DHL Express: 10 algarismos, nunca letras |
| UPS | `1Z` + 16 letras e algarismos, 18 caracteres no total, como `1Z999AA10123456784`, um exemplo com um dígito de controlo UPS válido |
| [Correos Express](carrier:correos-express) | a Correos Express não publica um formato; nos dados de transportadoras que o Peek usa, 16 algarismos (também DHL eCommerce, Canada Post, TNT e Evri UK) ou 23 algarismos, ambos terminados num dígito de controlo; com 000 nas posições 15 a 17, o Peek toma um número de 23 algarismos pela Australia Post |
| [NACEX](carrier:nacex) | a caixa de seguimento da NACEX mostra `0000/00000000`: quatro algarismos da agência de onde a encomenda partiu, uma barra e oito algarismos do «Nº expedição»; a NACEX não fixa o comprimento |
| Ecoscooting | a página de seguimento não indica um formato; nos dados de transportadoras que o Peek usa, `CNPRT` + 20 algarismos é Ecoscooting |
| Amazon | a Amazon não publica um formato; os números `TBA` e `PT…` estão explicados mais abaixo |
| [Cainiao](carrier:cainiao) (AliExpress) | a Cainiao não descreve os seus números; nos dados de transportadoras que o Peek usa, `LP` ou `CNG` + 14 algarismos pode ser Cainiao, e `DOFR` ou `CNFR` + 13 algarismos + `HD` é Cainiao |
| [YunExpress](carrier:yunexpress) | `YT` + 16 algarismos (`YT` + 13 algarismos é a YTO Express) |
| China Post, EMS | o formato postal terminado em `CN`; os números EMS internacionais começam por `E` |

### O que significam as letras de um código de envio dos CTT?

Segundo os CTT, o prefixo representa a solução de envio, ou seja, o produto que o remetente contratou, e o sufixo é geralmente o país de origem do envio ou o país que criou o código. Na ajuda dos CTT, os códigos estão separados pela primeira letra, porque é ela que decide o que podes mudar na entrega:

- `DA`, `DB`, `DC`, `DW`, `DX`, `DY` ou `DZ`: podes seguir a entrega e, no site ou na App CTT, mudar a morada ou o Ponto de Contacto CTT, escolher outra data ou pedir uma nova tentativa de entrega.
- `DS` ou `DT`: as alterações dependem do que o remetente contratou e só se pedem pela Linha de Apoio dos CTT.
- `DD`, `DE` e `DF`: só o remetente, cliente contratual dos CTT, pode pedir alterações; se quiseres mudar alguma coisa, fala com quem fez o envio. A mesma página põe também `DZ` nesta lista, apesar de o ter incluído na primeira.
- `C`, `G`, `L`, `O`, `R` ou `V`: consoante o que te enviaram, podes seguir a entrega, pedir um SIGA (nova tentativa, outra morada ou outra Loja ou Ponto CTT) ou, numa encomenda postal, prolongar o prazo de levantamento.

## Quantos algarismos tem um número de seguimento?

Não há um comprimento único. Estes são os comprimentos que as transportadoras indicam nas suas próprias páginas, e as sobreposições mostram porque é que um número só com algarismos pode ser de várias:

| Comprimento | Quem o usa |
| --- | --- |
| 8 caracteres | InPost, no exemplo da sua página de seguimento; Mondial Relay (8, 10 ou 12 algarismos) |
| 10 algarismos | DHL Express; Mondial Relay |
| 12 algarismos | Mondial Relay; FedEx Ground Economy, nos EUA |
| 13 caracteres | o formato postal dos CTT e dos outros operadores postais |
| 14 algarismos | DPD; La Poste, em França |
| 22 algarismos | CTT, só algarismos; USPS, nos EUA |
| 25 algarismos | CTT, só algarismos |

## Número que começa por TBA ou PT: é da Amazon?

Se tiver o comprimento certo, sim. Nos dados de transportadoras que o Peek usa, `TBA`, `TBC` ou `TBM` seguido de 12 algarismos é Amazon Logistics, o serviço de entregas da própria Amazon, e o mesmo vale para um código de país como `PT` ou `ES` seguido de 10 algarismos. As páginas de ajuda da Amazon não descrevem o número. A Amazon.es explica que a Amazon Logistics trabalha com parceiros de transporte locais e regionais, e que segues a encomenda em *Os meus pedidos*, onde aparece a informação desses parceiros.

Não confundas com um código de envio dos CTT que *termina* em `PT`: esse tem 13 caracteres, duas letras no início e duas no fim.

## O formato postal: duas letras, nove algarismos, duas letras

Os operadores postais partilham um formato de 13 caracteres, definido pela União Postal Universal (UPU) na norma S10. Aqui fica ele, peça a peça:

:::anatomy RR 12345678 5 CH
- RR | Tipo de envio: R para correio registado
- 12345678 | Número de série, oito algarismos
- 5 | Dígito de controlo, calculado a partir do número de série
- CH | País que emitiu o número: a Suíça
:::

Na correspondência que atravessa uma fronteira, a primeira letra indica o tipo de envio. Dentro do próprio país, cada operador pode usar as letras à sua maneira, e é o que fazem os CTT com os códigos de envio começados por `D`.

- `E`: EMS, o serviço expresso dos correios
- `C`: encomenda postal
- `R`: correio registado
- `L`: carta com seguimento
- `V`: carta com valor declarado
- `U`: mercadoria enviada como carta, sem seguimento para ti

As duas últimas letras nem sempre são o país de partida. A UPU diz que o código de país não é um indicador fiável da origem geográfica de um envio: os correios suíços usam `CH` nos envios que expedem dos seus escritórios no estrangeiro, e os CTT dão números criados em Portugal, terminados em `PT`, a envios que os seus clientes contratuais expedem de Espanha, da China e de outros países.

O dígito de controlo serve para apanhar erros de escrita. Para testar um número:

1. Multiplica os oito algarismos do número de série por 8, 6, 4, 2, 3, 5, 9 e 7, e soma os resultados.
2. Divide por 11 e subtrai o resto a 11.
3. Se der 10, o dígito é 0; se der 11, é 5.

Para `RR123456785CH`: 8 + 12 + 12 + 8 + 15 + 30 + 63 + 56 = 204, que dividido por 11 deixa resto 6, e 11 − 6 = 5. Se um número neste formato que copiaste à mão falhar o teste, procura um algarismo mal escrito ou dois trocados. O exemplo dos CTT, `RD123456789PT`, serve só para mostrar a forma e não passa no teste.

### Número que começa por UL ou UU: de quem é?

Se tiver 13 caracteres e acabar em duas letras, como `CN`, está no formato postal e é da série `U`: mercadoria enviada como carta. As duas últimas letras mostram que operador postal o emitiu. Um número mais comprido que comece por `UU` não está neste formato: procura a transportadora no e-mail de envio.

> Na correspondência que vem do estrangeiro, um número no formato postal começado por `U` (de `UA` a `UZ`) não é para seguires. A UPU reserva essa série para mercadoria enviada como carta, sem seguimento pensado para o cliente, e os correios belgas bpost dizem claramente que uma encomenda assim não se pode seguir. Não esperes que comece a atualizar mais tarde.

## Números que não são o teu número de seguimento

O número da encomenda na loja não funciona no site da transportadora (atenção: na DPD, o «número de encomenda» é o próprio número de seguimento, de 14 algarismos), e o PIN de um cacifo Locky ou de um Locker InPost só serve para o abrir. Onde está o número certo, e o que fazer se não tens nenhum: [onde encontrar o número de seguimento](guide:find-tracking-number).

## Porque é que o número de seguimento pode mudar pelo caminho

Uma encomenda que atravessa uma fronteira muda muitas vezes de mãos, e cada empresa pode imprimir a sua etiqueta. A UPU permite que o operador postal que a recebe acrescente o seu próprio código de barras ao lado do original, desde que não seja no formato postal de 13 caracteres.

:::journey
- shop | Vendedor | Imprime a etiqueta e o primeiro número
- plane | Longo curso | Viaja com esse primeiro número
- customs | Alfândega | Controlo no teu país
- handover | Transportadora local | Pode pôr etiqueta e número próprios
- home | A tua porta | As últimas leituras podem aparecer só no número novo
:::

- **Os envios postais** são o caso fácil: a UPU só permite um número S10 por envio, por isso costuma funcionar nos sites dos dois operadores postais.
- **Nos envios que os CTT mandam para fora**, depois de saírem de Portugal o Seguir objeto só mostra o que os países de trânsito e de destino passam aos CTT, e essa informação pode chegar tarde ou nem chegar.
- **Nos envios económicos do AliExpress**, a Cainiao diz que o seguimento acaba na entrega à transportadora local, e que o vendedor te pode dizer como contactar essa transportadora. Mais em [como seguir uma encomenda da China](guide:tracking-from-china).

Um número que não dá resultados nem sempre está mal escrito. Os CTT dão duas razões: o número pode servir apenas para [fins aduaneiros](guide:customs), ou o envio pode ser entregue em Portugal por outra empresa. Em qualquer dos casos, dizem para contactares o remetente. E a DHL Express avisa que recicla periodicamente os números de carta de porte, por isso o seguimento pode, de vez em quando, misturar dados de dois envios com o mesmo número. Se um número válido simplesmente ainda não se mexeu, lê [porque é que o tracking não atualiza](guide:tracking-not-updating).

:::sources
- [UPU: S10 standard, Identification of postal items](https://www.upu.int/UPU/media/upu/files/postalSolutions/programmesAndServices/standards/S10-12.pdf) – o formato postal, as letras, o dígito de controlo, o código de país, o código acrescentado no destino
- [CTT: Encontrar o código do envio](https://www.ctt.pt/ajuda/particulares/seguir-ou-alterar-entrega/seguir/encontrar-o-codigo-de-envio) – 2 letras, 9 algarismos e 2 letras, 22 ou 25 algarismos, o prefixo e o sufixo, números PT de envios do estrangeiro, números sem resultados, o PIN dos cacifos Locky
- [CTT: Tenho um código que começa por D](https://www.ctt.pt/ajuda/particulares/seguir-ou-alterar-entrega/alterar/tenho-um-codigo-que-comeca-por-d-o-que-posso-fazer) – o que se pode alterar consoante o prefixo D
- [CTT: Tenho um código que começa por C, G, L, O, R ou V](https://www.ctt.pt/ajuda/particulares/seguir-ou-alterar-entrega/alterar/tenho-um-codigo-que-comeca-por-c-g-l-o-r-u-ou-v-o-que-posso-fazer) – seguir, pedir um SIGA ou prolongar o levantamento
- [CTT: Objetos enviados para outros países que deixaram de ter informação](https://www.ctt.pt/ajuda/particulares/seguir-ou-alterar-entrega/seguir/objetos-enviados-para-outros-paises-pelos-ctt-e-que-deixaram-de-ter-informacao-no-seguir-objeto) – a informação depende dos países de trânsito e de destino
- [DPD Portugal: Track & Trace](https://www.dpd.com/pt/pt/receber-encomenda/track-trace/) – número de encomenda de 14 dígitos ou número de referência
- [GLS Portugal: Seguir um envio](https://gls-group.com/PT/pt/receber-envios/seguir-envio/) – números de encomenda ou ID de Rastreamento do cartão de notificação
- [InPost Portugal: Rastrear encomenda](https://www.inpost.pt/seguimento-do-envio/) – o número de expedição, o exemplo de 8 caracteres
- [InPost Portugal: Contactos e Apoio ao Cliente](https://www.inpost.pt/fala-connosco) – o PIN que abre o cacifo
- [Ecoscooting: seguimento](https://ecoscooting.com/) – o campo pede o número de seguimento, sem indicar formato
- [DHL Express Netherlands: DHL Express or DHL eCommerce number](https://www.dhlexpress.nl/en/consumer/faq/express-account-zendingsnummer/my-shipment-number-dhl-express-or-dhl-ecommerce) – 10 algarismos, nunca letras
- [MyDHL Express Portugal: FAQs Localização e Monitorização](https://mydhl.express.dhl/pt/pt/help-and-support/faqs/tracking-monitoring.html) – números de carta de porte reciclados
- [UPS: sample package label](https://www.pld-certify.ups.com/CerttoolHelp/PLD0200/WebHelp_pld0200/LeadPackage.htm) – o número 1Z
- [Amazon.es: Entregas de Amazon Logistics](https://www.amazon.es/gp/help/customer/display.html?nodeId=GEW3XT9JEMBLTKRV&language=pt_PT) – parceiros de transporte locais e regionais, seguimento em Os meus pedidos
- [Universal Parcel Scraper: carrier catalog](https://github.com/plhery/universal-parcel-scraper/blob/main/data/catalog.json) – os formatos TBA, PT, ES, CNPRT, YT, LP, CNG, DOFR e CNFR, e os 16 e 23 algarismos da Correos Express, nos dados de transportadoras do Peek
- [NACEX Portugal: Página inicial](https://www.nacex.pt/) – a forma 0000/00000000 na caixa «Seguimento de envio»
- [NACEX Portugal: Seguimento](https://www.nacex.pt/irSeguimiento.do) – Agência e Nº expedição
- [YunExpress: YunTrack](https://www.yuntrack.com/) – números que começam por YT
- [Cainiao: Help centre](https://global.cainiao.com/helpDoc.htm) – sem seguimento depois da entrega à transportadora local nos envios económicos
- [bpost: Puis-je suivre mon colis en ligne ?](https://www.bpost.be/fr/faq/puis-je-suivre-mon-colis-en-ligne) – os códigos começados por U não se podem seguir
- [Mondial Relay Belgium: Suivi de colis](https://www.mondialrelay.be/fr-be/suivi-de-colis/) – 8, 10 ou 12 algarismos
- [La Poste: Comment suivre mon colis ou ma lettre](https://aide.laposte.fr/professionnel/contenu/comment-suivre-mon-colis-ou-ma-lettre) – 14 algarismos
- [USPS: Publication 199, Intelligent Mail package barcode](https://postalpro.usps.com/pub199) – 22 algarismos
- [FedEx Developer: FedEx Ground Economy announcement](https://developer.fedex.com/api/en-us/announcements/Apr2022-FGEAnnouncements.html) – 12 algarismos
:::
