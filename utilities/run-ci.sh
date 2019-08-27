#!/bin/bash
set -euo pipefail
IFS=$'\n\t'
# run in .travis.yml
# docker build -t helena:latest .
# set in .travis.yml
# SERVER_URL=http://helena-backend.us-west-2.elasticbeanstalk.com
# PROGRAM_ID=3700
# SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" > /dev/null && pwd )"
# RESULTS_FILE=$SCRIPT_DIR/../test/test_results.csv
RUN_ID=$(curl -v -H "Content-Type: application/json" -d "{\"name\":\"CI\", \"program_id\":${PROGRAM_ID}}" -X POST "${SERVER_URL}/newprogramrun" | perl -ne '/"run_id":(\d+)/; print $1')
docker run -t -e NO_VNC=1 -e HELENA_SERVER_URL=$SERVER_URL -e ROW_BATCH_SIZE=1 -e HELENA_PROGRAM_ID=$PROGRAM_ID -e HELENA_RUN_ID=$RUN_ID -e TIME_LIMIT_IN_HOURS=23 -e NUM_RUNS_ALLOWED_PER_WORKER=1 -e DEBUG=1 --user apps --privileged helena:latest
# docker run -t -p 5901:5900 -e HELENA_SERVER_URL=$SERVER_URL -e ROW_BATCH_SIZE=1 -e HELENA_PROGRAM_ID=$PROGRAM_ID -e HELENA_RUN_ID=$RUN_ID -e TIME_LIMIT_IN_HOURS=23 -e NUM_RUNS_ALLOWED_PER_WORKER=1 -e DEBUG=1 --user apps --privileged helena:latest
# compare scraped data to expected results
TEST_RESULTS_HASH=$(curl -v $SERVER_URL/datasets/run/$RUN_ID | md5sum | awk '{print $1}')
EXPECTED_RESULTS_HASH=$(cat $RESULTS_FILE | md5sum | awk '{print $1}')
if [ $TEST_RESULTS_HASH != $EXPECTED_RESULTS_HASH ]; then
    >&2 echo "Unexpected test results!"
    exit 1
fi
exit 0
