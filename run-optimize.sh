#!/bin/bash
cd /home/team/shared/site
node optimize-welcome.js
echo "OPTIMIZE_EXIT=$?" > /tmp/opt-result.txt
ls -lh public/welcome-*-opt.* >> /tmp/opt-result.txt 2>&1
