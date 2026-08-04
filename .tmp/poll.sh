#!/bin/bash
JOB=$1
while true; do
  s=$(curl -s "http://localhost:6869/api/jobs/$JOB" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.status+'|'+j.progress+'|'+j.step)})")
  echo "$(date +%H:%M:%S) $s"
  case "$s" in
    done*|failed*|canceled*) break ;;
  esac
  sleep 20
done
