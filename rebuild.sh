#!/bin/bash
cd /home/team/shared/site
sudo kill $(lsof -t -iTCP:3000 -sTCP:LISTEN) 2>/dev/null
rm -rf dist
bash ./publish.sh
echo "REBUILD_DONE"
curl -sI http://localhost:3000 | head -5
