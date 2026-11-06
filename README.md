# Lastro | Portal Patrimonial

Dashboard responsivo em React e TypeScript para consolidar investimentos. API Node/Express com autenticacao e persistencia em **JSON por cliente**. Processamento dos arquivos no navegador e cotacoes **simuladas**, sem conexao com corretoras.

## Executar

Requer Node.js 22.12+ (validado com 24.11).

```sh
npm install
npm run dev
```

Esse comando inicia a API em `127.0.0.1:3001` e o portal em `http://localhost:5173`. A porta do portal e fixa para manter a validacao de origem da autenticacao. Encerre servidores antigos antes de executar o comando. `npm run dev:api` e `npm run dev:web` iniciam os processos separadamente.

A configuracao padrao funciona sem `.env`. As variaveis opcionais estao em `.env.example`: `HOST`, `PORT`, `APP_ORIGIN`, `LASTRO_DATA_DIR`, `NODE_ENV` e `BRAPI_API_KEY`. A chave da brapi deve ficar apenas no `.env` local, nunca no frontend ou em arquivos versionados.

```sh
npm test
npm run lint
npm run build
npm run check
```

## Funcionalidades

- Cadastro, login e logout com sessao persistente e carteira isolada por cliente.
- Salvamento automatico no servidor, aviso de falha e controle de revisoes entre abas.
- Resumo de patrimonio, custo, lucro e resultado diario.
- Graficos de evolucao e alocacao por classe; filtros, busca e ordenacao.
- Importacao CSV/PDF/TXT por selecao ou arrastar e soltar, com previa e confirmacao.
- Historico de importacoes e bloqueio de arquivos identicos por SHA-256.
- Preco medio ponderado, conciliacao de custo sem duplicar quantidades e exportacao CSV.
- Analise de notas B3 por ativo, com preco medio de compra e simulacao bruta de venda.
- Valores ocultaveis e preferencia de atualizacao diaria.

## Primeira Conta e Migracao

Abra o portal e selecione **Criar conta**. Informe nome, e-mail e senha de 6 a 128 caracteres. Nao existem contas ou senhas padrao.

Se houver uma carteira antiga no localStorage deste navegador, uma conta sem carteira real oferece **Transferir para minha conta**. A transferencia exige confirmacao e a copia local so e removida depois que o servidor confirma o salvamento. Recusar a transferencia preserva os dados locais. Nao ha migracao automatica para outro cliente.

## Armazenamento JSON

Por padrao, os arquivos ficam em `data/`, fora de `dist/` e ignorados pelo Git. `LASTRO_DATA_DIR` permite usar outro diretorio privado.

```text
data/
	clients/<uuid>.json       # Nome, e-mail e hash de senha
	portfolios/<uuid>.json    # Carteira, historico, importacoes e revisao
	sessions/<sha256>.json    # Sessoes com validade e identificador do cliente
	backups/<uuid>.json       # Versao imediatamente anterior da carteira
```

Cada carteira e acessada pelo identificador da sessao autenticada, nunca por um caminho enviado pelo frontend. Gravacoes usam arquivo temporario, sincronizacao e substituicao atomica; um controle de revisao rejeita sobrescritas de abas desatualizadas. Falhas preservam as alteracoes na tela e permitem tentar salvar novamente. Ao sair, o portal tenta concluir o salvamento antes de encerrar a sessao.

O backup automatico guarda **somente a versao anterior**, nao substitui backup externo. Faca copias regulares de todo o diretorio de dados, preferencialmente com a API parada ou por snapshot do volume. Proteja e criptografe os backups. Nao edite JSONs enquanto a API estiver em execucao. Esta implementacao suporta **um unico processo da API**; nao execute varias instancias sobre os mesmos arquivos.

## Autenticacao e Limites

Senhas usam `scrypt` com salt aleatorio. Tokens de sessao sao aleatorios, ficam em cookie `HttpOnly`/`SameSite=Lax` e apenas seu hash e persistido. Sessoes duram sete dias e sao invalidadas no logout. Requisicoes de escrita exigem origem permitida e JSON; tentativas de autenticacao sao limitadas por IP.

Em desenvolvimento HTTP, o cookie nao usa `Secure`. Em producao, configure `NODE_ENV=production` e `APP_ORIGIN` com a URL **HTTPS** publica, execute `npm run build` e `npm start` atras de um proxy TLS. Nesse modo, a API serve somente `dist/` e emite cookie `Secure`. Nao publique a pasta do projeto como raiz de arquivos estaticos; o servidor Vite e apenas para desenvolvimento e bloqueia `data/`.

O cadastro esta aberto nesta versao. Ainda nao ha verificacao de e-mail, recuperacao de senha, MFA, painel administrativo ou criptografia dos JSONs em repouso. Restrinja o acesso ao servidor e ao disco; revise esses pontos antes de disponibilizar para clientes pela internet. Nao ha senha em texto puro nem token de sessao no localStorage.

## Importacao de Multiplas Plataformas

Extratos CSV, Excel e PDF passam por **Conferir colunas** antes da previa. A identificacao sugere tabelas, cabecalhos e campos, mas o usuario pode selecionar tabelas, corrigir a linha de cabecalho, associar cada coluna, escolher a classe padrao e confirmar o formato numerico. Use **Gerar previa** para validar e **Revisar colunas** para corrigir antes da confirmacao final.

O reconhecimento cobre, entre outros, `Fundo`, `Qtd. Cotas`, `Vr. Financeiro`, saldos, cotacoes, custos e secoes de carteira. Fundos e Previdencia sao classes proprias. Em extratos com contribuicoes de participante e patrocinadora, as linhas do mesmo investimento sao consolidadas; a origem da contribuicao nao vira o nome do ativo. Quando presentes, ticker, ISIN e CNPJ sao preferidos ao nome comercial. Sem identificador unico, a previa alerta para conferir fundos homonimos.

**Cotacao atual nao e preco medio de compra.** Valores ausentes/indefinidos permanecem desconhecidos. `Valor` sozinho e ambiguo e nao recebe significado financeiro automatico; associe-o ao campo correto. O saldo de mercado informado tem prioridade sobre cotacao multiplicada pela quantidade, com alerta quando os dois divergem.

A previa informa linhas de origem, ativos consolidados, linhas auxiliares ignoradas e totais conferidos. Totais/subtotais reconhecidos sao comparados com a soma das posicoes; divergencias bloqueiam a geracao da previa. Sem total reconhecido, isso fica explicito. Tabelas nao selecionadas tambem geram aviso. A carteira so e alterada na confirmacao final.

Os modos numericos sao automatico, brasileiro (`1.234,56`) e internacional (`1,234.56`). O modo automatico bloqueia notacoes ambiguas como `1.000` ate o formato ser escolhido. Valores numericos nativos do Excel preservam seus valores. A moeda continua sendo BRL: colunas de moeda estrangeira sao rejeitadas, sem conversao cambial automatica.

O mapeamento e mantido durante a importacao atual, nao e um cadastro persistente de modelos por corretora. PDFs digitalizados continuam precisando de OCR externo; extracoes com colunas inseparaveis ou layouts nao tabulares podem exigir Excel/CSV. Nao ha garantia de interpretar automaticamente qualquer exportacao. Para adaptar um modelo especifico com confianca, teste o arquivo original e valide o total, nao apenas uma imagem.

## Extratos CSV

CSV representa uma posicao consolidada e **substitui** a carteira atual apos confirmacao. Aceita virgula ou ponto e virgula como separador, cabecalhos com ou sem acentos e valores brasileiros como `1.250,50`. Numeros com apenas ponto sao tratados como decimais: use `1000`, nao `1.000`, para mil unidades.

```csv
Ativo;Nome;Tipo;Quantidade;Preco Medio;Cotacao
PETR4;Petrobras;Acoes;100;30,00;37,85
HGLG11;Patria Log;FIIs;10;155,20;160,35
```

Obrigatorios: ativo/ticker, quantidade e cotacao unitaria **ou** valor atual total. `Valor Atual` e sempre o total da posicao, nao o preco unitario. Preco medio/custo total sao opcionais; sem custo, o resultado fica indisponivel. A classe explicita tem prioridade; a inferencia por ticker e heuristica. Ativos repetidos devem ser consolidados antes da importacao.

## Extratos Excel (.xlsx)

A aba **Extrato CSV / Excel** aceita arquivos `.xlsx` diretamente, tanto por selecao quanto por arrastar e soltar, sem conversao para CSV. O processamento continua local, com previa antes de substituir a carteira.

O leitor procura as posicoes em todas as abas, reconhece titulos antes do cabecalho e ignora capas, linhas vazias e totais. Aceita colunas como `Produto`, `Codigo de Negociacao`, `Quantidade`, `Preco de Fechamento` e `Valor Atualizado`, alem dos nomes do modelo CSV. `Valor Atualizado` e o valor total da posicao. Posicoes do mesmo ativo em instituicoes diferentes sao consolidadas. Custos ausentes permanecem desconhecidos.

Tambem reconhece o layout `Sua carteira`, com blocos de Renda Fixa, Fundos Imobiliarios e Tesouro Direto e cabecalhos repetidos. Nesse layout, `Saldo a mercado`/`Saldo` define o valor de mercado; `Preco medio (abertura)` define o custo unitario quando disponivel. Para titulos sem preco medio, usa `Valor aplicado original` (ou `Valor aplicado`, se o original nao existir) dividido pela quantidade. `Indefinido` permanece como custo desconhecido. Saldos em conta e totais de secao nao sao importados como ativos.

Layouts sem colunas reconheciveis sao rejeitados; posicoes invalidas indicam a aba e a linha. Arquivos `.xls` antigos devem ser salvos como `.xlsx` no Excel ou LibreOffice antes de importar. Planilhas protegidas por senha nao sao suportadas.

## Extratos PDF

A aba **Extrato de posicoes** aceita CSV, Excel e PDF com texto selecionavel. O PDF deve ter uma tabela com ativo/produto, quantidade e cotacao ou valor atual total. Preco medio e custo total sao opcionais; custos ausentes ou indefinidos continuam desconhecidos.

A leitura usa as coordenadas do texto para separar colunas, reconhece tabelas em varias paginas e secoes como Renda Fixa, Fundos Imobiliarios e Tesouro Direto. Quando houver saldo de mercado e preco unitario, o saldo define o patrimonio. Posicoes repetidas sao consolidadas. Os dados aparecem em previa e so alteram a carteira depois da confirmacao.

PDFs protegidos por senha devem ser exportados sem protecao. PDFs digitalizados ou compostos apenas por imagens precisam de OCR externo. Layouts sem tabela reconhecivel devem ser exportados em Excel/CSV. A extensao PDF nao garante que qualquer layout de corretora seja interpretado automaticamente.

## Notas de Compra

TXT ou PDF com texto selecionavel, com uma compra por linha neste formato:

```text
COMPRA PETR4 100 30,00
COMPRA PETR4 50 36,00
```

O resultado e 150 unidades com preco medio de R$ 32,00. A letra `C` tambem e aceita. Limite de 15 MB por arquivo.

**Adicionar compras:** soma quantidades e pondera o custo anterior. A primeira nota substitui os dados demonstrativos.

**Conciliar preco medio:** preserva quantidades e cotacoes do CSV. As notas devem cobrir a quantidade total do ativo; entregue o historico completo desse ativo em um arquivo. As compras de ativos diferentes podem ser conciliadas em arquivos separados.

PDFs digitalizados precisam de OCR externo. Layouts arbitrarios de corretoras, vendas, taxas, dividendos, impostos e cambio nao sao suportados. Todos os valores devem estar previamente em BRL. Use os modelos disponiveis no modal.

## Cotacoes e Historico

As cotações de ativos negociados na B3 podem ser atualizadas pela API brapi com `BRAPI_API_KEY`, consultada no servidor e nunca enviada ao navegador. A atualização é diária enquanto a página está aberta ou pode ser acionada manualmente. Sem chave ou sem cobertura para um ticker, o Lastro mantém o preço do extrato e avisa que a cotação real não foi atualizada; não gera variações simuladas.

A carteira demonstrativa tem historico claramente ilustrativo. Importacoes iniciam uma nova base historica, e atualizacoes registram o patrimonio diario. Retornos sao variacoes simples sobre o custo, nao TWR/IRR.

Para evoluir: banco de dados, backups externos, adaptadores por corretora, recuperacao de acesso e agendador de servidor. Nao exponha tokens de APIs no frontend.

Os arquivos originais nao sao enviados nem armazenados no servidor; somente os dados extraidos e confirmados sao salvos na conta. Fontes Google e logotipos publicos da brapi sao recursos externos. Limpar o navegador nao remove carteiras ja salvas no servidor. A exportacao CSV salva posicoes, nao o historico completo de importacoes; o backup completo e feito pelo diretorio de dados.
