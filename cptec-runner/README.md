# CPTEC Nowcasting Runner

Este diretório reúne a arquitetura do coletor CPTEC e os testes dos formatos de URL.
O código principal fica em `collector.py`; o workflow está em
`.github/workflows/cptec-nowcasting-collector.yml`.

## Estrutura do identificador observado

A URL usa o formato:

```
/api/v1/paths/frames/radar/<provedor>~<radar>~<grupo>~<variável>/<YYYYMMDDHHmm>/full
```

Exemplos observados no próprio Nowcasting:

- `sdcsc~lontras~ppi~ppicz`
- `sdcsc~lontras~agua_liquida~dvil`
- `sdcsc~lontras~echotop~echotop20dbz`
- `decea~santiago~cappi~cappi3km`

O coletor **não pressupõe que todo provedor tenha os mesmos produtos**. Ele constrói o
inventário a partir da árvore de caminhos e dos arquivos de dados que o frontend do
CPTEC referencia. Os nomes de provedor, radar, grupo, variável e horário vêm dos IDs
encontrados na fonte, sem fabricar combinações que não estejam disponíveis.

## Saída

- `discovery.json`: árvore percorrida, URLs consultadas, status HTTP e erros.
- `catalog.json`: caminhos encontrados durante a fase de descoberta.
- `index.json`: quadros baixados, agrupados por provedor/radar/produto/horário.
- `errors.json`: falhas individuais de download.
- `frames/<provedor>/<radar>/<grupo>/<variável>/<timestamp>.<ext>`: imagens originais.

## Teste offline

Na raiz do repositório, depois de instalar a dependência `requests`:

```powershell
python cptec-runner/test_catalog.py
```

Esse teste valida as quatro URLs reais fornecidas e a navegação simulada da árvore,
sem enviar requisições à API. A coleta completa ainda precisa ser confirmada com uma
execução ao vivo; a primeira resposta real e seus status ficam em `discovery.json`.
