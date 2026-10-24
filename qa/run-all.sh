#!/usr/bin/env bash
# Roda todas as suítes de QA do motor e imprime o resumo. Uso: bash qa/run-all.sh
cd "$(dirname "$0")"
mkdir -p results
for s in 01-variaveis-scripts 02-http 03-tls 04-grpc 05-import-export 06-workspace 07-offline 08-xml-soap 09-performance zz-codegen-zipslip; do
  timeout 600 node --expose-gc "$s.js" > "results/$s.log" 2>&1
  grep -E "^==" "results/$s.log" || echo "== $s: NÃO TERMINOU (ver results/$s.log)"
done
# Interface (precisa de display virtual): fluxo completo, extras (temas, ajuda, cancelar...) e performance da UI
if command -v xvfb-run >/dev/null; then
  ( cd ../apps/desktop && npx vite build --config renderer/vite.config.mjs >/dev/null 2>&1
    for t in e2e/flow.js ../../qa/e2e-extra.js ../../qa/perf-ui.js; do
      timeout 900 xvfb-run -a -s "-screen 0 1440x900x24" node $t > "../../qa/results/$(basename $t .js).log" 2>&1
      grep -E "^== |passaram" "../../qa/results/$(basename $t .js).log" | tail -1 || echo "== $t: ver log"
    done )
fi
