# S.D.P 0.2 — notas de arquitetura

## Estados de um evento

1. `pick` — um detector encontra uma chegada candidata.
2. `candidate` — picks de várias estações entram na mesma janela temporal.
3. `automatic_preliminary` — o localizador encontra solução com RMS e geometria aceitáveis e a latência é compatível com EEW.
4. `automatic_late` — há evento plausível, mas os dados chegaram tarde demais para serem rotulados como baixa latência.
5. `catalog_confirmed` — um evento FDSN compatível em tempo/espaço substitui os parâmetros preliminares disponíveis.

Cada solução automática recebe `revision` crescente.

## Regra de latência

`latency = received_at_backend - trace_end_time`

Essa métrica inclui atraso de transmissão/servidor, mas não mede sozinha toda a cadeia do instrumento ao navegador. Ela é usada para impedir que um pacote antigo gere uma notificação que pareça instantânea.

## Picking

### STA/LTA

Fallback simples, barato e sempre disponível. Opera na componente vertical após filtro 0.8–12 Hz. O score é transformado apenas em uma confiança heurística; não é probabilidade calibrada.

### PhaseNet

Worker opcional com SeisBench. Recebe janelas de múltiplos componentes e produz picks P/S. A inferência fica fora da thread de ingestão.

## Associação

A janela mantém no máximo o melhor pick de cada par estação/fase. O evento só é localizado quando existe o mínimo de estações distintas configurado.

## Localização

A busca usa uma aproximação regional de velocidade constante para ser rápida:

- P: configurável, padrão 6.0 km/s;
- S: configurável, padrão 3.5 km/s.

O custo usa residual robusto e pesos derivados da confiança e latência. Após uma primeira solução, picks com residual muito grande podem ser removidos e a localização é repetida.

## Profundidade

Sem S suficiente, é explicitamente tratada como não resolvida e recebe um prior próximo de 10 km. Com pelo menos dois picks S, profundidades candidatas podem ser comparadas.

## Confirmação de catálogo

O catálogo nunca é usado para fingir detecção antecipada. Ele é uma camada posterior de confirmação/histórico.

## Próxima arquitetura recomendada

Quando houver hardware suficiente, separar em serviços:

```text
seedlink-ingestor
      │
      ├── raw waveform queue
      │
      ├── lightweight picker
      │
      └── ML picker GPU/CPU
               │
               ▼
          pick stream
               │
               ▼
        associator service
               │
               ▼
          locator service
               │
          ┌────┴────┐
          ▼         ▼
       API/WS    storage
```

Isso permite reiniciar PhaseNet sem derrubar SeedLink e medir latência de cada etapa separadamente.
