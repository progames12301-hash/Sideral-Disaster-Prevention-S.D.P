# Sideral Disaster Prevention — S.D.P

Sistema experimental de detecção sísmica e Earthquake Early Warning (EEW) para o Brasil.

A versão **0.2** foi desenhada para usar formas de onda em tempo quase real via SeedLink, medir a latência real de cada estação, detectar chegadas sísmicas, associar picks de múltiplas estações, localizar um evento preliminar e transmitir revisões ao painel web por WebSocket. O frontend mostra epicentro, incerteza, frentes aproximadas das ondas P/S, estações, atrasos de dados e tempo estimado de chegada a um ponto escolhido pelo usuário.

> **Importante:** este projeto é experimental e não oficial. Não substitui informações da Rede Sismográfica Brasileira, USP/IAG, Observatório Nacional, UnB, UFRN, Defesa Civil ou qualquer autoridade. Dados públicos em tempo real podem chegar com atraso; o software diferencia uma detecção de baixa latência de uma detecção tardia para não chamar todo evento de “alerta antecipado”.

## Arquitetura 0.2

```text
SeedLink USP / outros nós
      │
      ├──► telemetria de latência por estação/canal
      │
      ├──► STA/LTA vertical (fallback leve)
      │
      └──► PhaseNet/SeisBench opcional (3 componentes)
                     │
                     ▼
              picks P e S
                     │
                     ▼
          associação multiestação
                     │
                     ▼
      localizador robusto em grade
      • P + S
      • profundidade em candidatos
      • rejeição de outliers
      • RMS / gap / incerteza
                     │
          ┌──────────┴──────────┐
          ▼                     ▼
 catálogo FDSN USP      FastAPI + WebSocket
 confirmação posterior          │
                                ▼
                         Leaflet / PWA
```

## Fonte principal preparada

A configuração padrão usa:

- SeedLink USP/IAG: `seisrequest.iag.usp.br:18000`
- redes iniciais: `BL`, `BR`
- metadados: FDSN Station USP
- catálogo de confirmação: FDSN Event USP

Outras fontes estão preparadas por configuração, mas ficam desabilitadas até serem testadas no host de produção. Não assuma que um endpoint histórico continua operacional só porque está presente no código.

## O que mudou da 0.1 para a 0.2

### 1. Latência passou a fazer parte do algoritmo

Cada pacote recebido registra:

- instante do último dado sísmico;
- instante em que chegou ao backend;
- atraso em segundos;
- classe de latência: `realtime`, `delayed`, `late` ou `stale`.

Dados muito antigos ainda podem servir para monitoramento e localização posterior, mas não criam um novo alerta como se fossem dados atuais.

Um evento recebe `eewEligible=true` apenas quando a mediana da latência dos picks usados está abaixo do limite configurado.

### 2. Associação com revisões

O evento deixa de ser uma solução única. Cada novo conjunto compatível pode gerar uma nova `revision` do mesmo evento. O painel atualiza epicentro, profundidade, RMS, gap, confiança e incerteza sem criar um novo terremoto a cada pick.

### 3. Picks P e S

O modelo de dados agora distingue fase `P` e `S`.

O STA/LTA leve continua sendo o fallback para P em componente vertical. Para S e picking mais robusto, a 0.2 inclui um worker opcional de **PhaseNet via SeisBench**, processado fora da thread do SeedLink para não bloquear a recepção de dados.

### 4. Três componentes

A busca de metadados tenta escolher uma família coerente de canais por estação, preferindo `HH`, `BH`, `EH`, `HN` e `SH`, com Z e horizontais compatíveis quando disponíveis.

### 5. Localização mais robusta

O localizador agora:

- usa velocidade apropriada para P ou S;
- faz busca grossa, fina e micro;
- usa custo robusto tipo Huber;
- reduz o peso de picks com baixa confiança ou grande latência;
- remove picks com residual excessivo;
- mede gap azimutal;
- calcula uma incerteza aproximada;
- testa profundidades candidatas.

### 6. Profundidade não é fingida

Com somente picks P, a profundidade regional costuma ficar fortemente acoplada ao tempo de origem. Por isso a 0.2 **não declara profundidade como resolvida** apenas porque uma grade matemática encontrou um mínimo.

Enquanto não existirem pelo menos dois picks S independentes, o sistema usa um prior crustal próximo de 10 km e marca `depthResolved=false`. O painel mostra `≈10 km` em vez de aparentar precisão inexistente.

### 7. PhaseNet opcional

A instalação padrão permanece leve:

```bash
pip install -r requirements.txt
```

Para ativar o worker de ML:

```bash
pip install -r requirements-ml.txt
```

E defina:

```env
SDP_PHASE_PICKER=hybrid
```

`hybrid` mantém STA/LTA como fallback e também executa PhaseNet. O modelo é carregado em uma thread separada e as janelas são processadas sem bloquear o SeedLink.

> PyTorch/SeisBench consomem muito mais RAM e CPU. Não habilite o worker de ML em um host pequeno sem medir memória, tempo de inferência e atraso fim a fim.

## Interface 0.2

O painel mostra:

- mapa Leaflet em tons de cinza;
- estações sísmicas;
- cor da estação de acordo com latência;
- epicentro preliminar;
- círculo de incerteza;
- frentes P e S aproximadas;
- quantidade de picks P/S;
- quantidade de estações;
- RMS;
- gap azimutal;
- confiança;
- mediana de latência dos picks;
- número de revisão;
- indicação **baixa latência / candidato EEW** ou **detecção com atraso**;
- histórico FDSN;
- ponto de interesse e ETA aproximada de P/S.

Sem áudio nesta fase.

## Magnitude

A magnitude automática continua intencionalmente desativada para a detecção bruta.

Contagens do sismômetro não são magnitude. Uma implementação adequada precisa, no mínimo:

1. conhecer a resposta instrumental;
2. remover essa resposta;
3. medir amplitude/período apropriados;
4. aplicar uma relação de magnitude calibrada;
5. validar contra eventos conhecidos.

Até isso existir, o S.D.P mostra `—` e usa a magnitude do catálogo quando uma correspondência posterior for encontrada.

## Rodar localmente

```bash
python -m venv .venv
```

Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn backend.app:app --host 0.0.0.0 --port 8000
```

Linux/macOS:

```bash
source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.app:app --host 0.0.0.0 --port 8000
```

Abra `http://localhost:8000`.

## Simulador

```powershell
$env:SDP_DEBUG_SIMULATOR="true"
uvicorn backend.app:app --host 0.0.0.0 --port 8000
```

Depois:

```bash
curl -X POST http://localhost:8000/api/simulate
```

## Variáveis principais

```env
SDP_ENABLE_USP=true
SDP_ENABLE_ON=false
SDP_ENABLE_UNB=false
SDP_ENABLE_UFRN=false

SDP_MIN_STATIONS=3
SDP_TRIGGER_ON=4.5
SDP_TRIGGER_OFF=1.5
SDP_STA_SECONDS=0.6
SDP_LTA_SECONDS=6.0
SDP_ASSOC_WINDOW_SECONDS=150
SDP_MAX_LOCATION_RMS=5.0
SDP_MAX_PICK_RESIDUAL=4.0

SDP_P_VELOCITY=6.0
SDP_S_VELOCITY=3.5
SDP_DEPTH_CANDIDATES_KM=5,10,20,35

SDP_MAX_DATA_LATENCY=40
SDP_EEW_MAX_PICK_LATENCY=8
SDP_THREE_COMPONENT_STREAMS=true

SDP_PHASE_PICKER=stalta
SDP_PHASENET_WEIGHTS=stead
SDP_PHASENET_P_THRESHOLD=0.45
SDP_PHASENET_S_THRESHOLD=0.45
SDP_PHASENET_WINDOW_SECONDS=45
SDP_PHASENET_INTERVAL_SECONDS=4
```

## Hospedagem

GitHub hospeda o código, mas GitHub Pages sozinho não executa SeedLink. SeedLink é um protocolo de streaming TCP; o backend precisa rodar continuamente em um ambiente que permita conexão TCP de saída.

O `render.yaml` mantém a instalação padrão sem PyTorch. Para produção de EEW, um processo que “dorme” por inatividade é inadequado: alguns minutos de suspensão eliminam qualquer possibilidade de alerta antecipado.

## Ainda não é um EEW operacional

A 0.2 melhora bastante o pipeline, mas ainda faltam validações críticas:

- testar latência real de cada estação por dias/semanas;
- validar picks com eventos históricos brasileiros;
- avaliar falso-positivo de STA/LTA e PhaseNet;
- substituir velocidades constantes por modelo regional adequado;
- calibrar associação para eventos locais, regionais e telessísmicos;
- persistir waveform/picks/eventos para auditoria;
- redundância de ingestão;
- cálculo de magnitude calibrado;
- modelo de intensidade/impacto validado para o Brasil;
- testes de carga e reconexão SeedLink;
- métricas de tempo `onda → estação → SeedLink → backend → navegador`.

O objetivo é que o sistema diga **“não sei”** quando a rede não sustenta uma conclusão, em vez de produzir números visualmente convincentes mas cientificamente fracos.
