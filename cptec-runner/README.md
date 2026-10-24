# CPTEC Nowcasting Runner

Este diretório concentra os testes do coletor CPTEC. O coletor principal fica em
\`collector.py\`; o workflow do GitHub Actions é
\`.github/workflows/cptec-nowcasting-collector.yml\`.

## Estrutura do identificador observado

A URL real tem este formato:

\`\`\`
/api/v1/paths/frames/radar/<provedor>~<radar>~<grupo>~<variável>/<YYYYMMDDHHmm>/full
\`\`\`

Exemplos observados no próprio Nowcasting:

- \`sdcsc~lontras~ppi~ppicz\`
- \`sdcsc~lontras~agua_liquida~dvil\`
- \`sdcsc~lontras~echotop~echotop20dbz\`
- \`decea~santiago~cappi~cappi3km\`

O coletor **não pressupõe que todo provedor tenha os mesmos produtos**. Ele constrói o
inventário a partir da árvore de caminhos e dos arquivos de dados que o frontend do
CPTEC realmente referencia. Os nomes de provedor, radar, grupo, variável e timestamp
são derivados dos IDs retornados pela fonte, sem inventar combinações ausentes.

## Saída

- \`discovery.json\`: árvore, URLs consultadas, resposta HTTP e erros da descoberta.
- \`catalog.json\`: durante a fase de descoberta, os caminhos de quadros encontrados.
- \`index.json\`: quadros baixados e inventário por provedor/radar/produto/horário.
- \`errors.json\`: falhas individuais de download.
- \`frames/<provedor>/<radar>/<grupo>/<variável>/<timestamp>.<ext>\`: imagens originais.

## Teste offline

Na pasta raiz do repositório, depois de instalar \`requests\`:

\`\`\`powershell
python cptec-runner/test_catalog.py
\`\`\`

Esse teste valida as quatro URLs reais fornecidas e a navegação simulada da árvore de
pastas sem disparar pedidos à API. A coleta completa ainda precisa ser validada contra
uma execução ao vivo; os detalhes da primeira resposta real ficam em \`discovery.json\`.
