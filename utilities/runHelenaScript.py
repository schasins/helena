# usage: python runHelenaDocker.py <helenaScriptNumericId> <numParallelBrowsers> <timeoutInHours> <howManyRunsToAllowPerWorker>
# ex: python runHelenaDocker.py 651 3 23.75 1000
# ex: python runHelenaDocker.py 927 1 1 1
# ex: python runHelenaDocker.py 927 1 1 1
# ex: python runHelenaDocker.py 945 3 23.75 1000
# ex: python runHelenaDocker.py 1012 1 1 1
# in the above, we want to let the script keep looping as long as it wants in 23.75 hours, so we put 1000 runs allowed
# it's probably more normal to only allow one run, unless you have it set up to loop forever

from selenium import webdriver
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.options import Options
import time
from sys import platform
import sys
from multiprocessing import Process, Queue
import traceback
import logging
import random
import requests
import numpy as np
from selenium.webdriver.common.desired_capabilities import DesiredCapabilities
import json
import os.path
import time
import re

extensionKey = sys.argv[1]
scriptName = int(sys.argv[2])
helenaRunId = int(sys.argv[3])
if (helenaRunId == -1):
    helenaRunId = None
timeoutInHours = float(sys.argv[4])
howManyRunsToAllowPerWorker = int(sys.argv[5])
serverUrl = sys.argv[6]
batchSize = int(sys.argv[7])
scriptParamsBlob = None
if (len(sys.argv) > 8):
    scriptParamsBlob = sys.argv[8]  # comma-delimited list of equals-separated key-value pairs
scriptParams = {}


def splitCustom(s, regex):
    a = re.finditer(regex, s)
    startindex = 0
    strs = []
    for k in a:
      strs.append(s[startindex:k.start()+1])
      startindex = k.end()
    strs.append(s[startindex:len(s)])
    return strs

if scriptParamsBlob:
    scriptParams = dict(tuple(pair.split("=",1)) for pair in splitCustom(scriptParamsBlob, r"[^\\](,)"))
    for key in scriptParams:
        val = scriptParams[key]
        val = val.replace("\,", ",")
        val = val[1:-1]
        scriptParams[key] = val
    print "script params:", scriptParams

debug = bool(os.environ.get('DEBUG'))
headless = False

if headless:
    from pyvirtualdisplay import Display
    display = Display(visible=0, size=(800, 800))
    display.start()


def newDriver(profile):
    chrome_options = Options()
    chrome_options.add_extension('/src.crx')

    desired = DesiredCapabilities.CHROME
    desired['loggingPrefs'] = {'browser': 'ALL'}

    driver = webdriver.Chrome(
        chrome_options=chrome_options, desired_capabilities=desired)
    driver.get("chrome-extension://" + extensionKey + "/pages/mainpanel.html")
    time.sleep(20)
    return driver


def runScrapingProgramHelper(driver, progId, optionsStr):
    driver.execute_script(
        'RecorderUI.setGlobalConfig({"helenaServerUrl":"%s","numRowsToSendInOneSlice":%d});' % (
            serverUrl, batchSize))
    driver.execute_script("RecorderUI.loadSavedProgram(" + str(progId) + ");")

    if debug:
        data = driver.get_log('browser')
        for line in data:
            print line

    runCurrentProgramJS = """
    function repeatUntilReadyToRun(){
        console.log("repeatUntilReadyToRun");
        // ringerUseXpathFastMode = true; // just for the peru one.  remove this later
        if (!RecorderUI.currentHelenaProgram){
            setTimeout(repeatUntilReadyToRun, 100);
        }
        else{
            RecorderUI.currentHelenaProgram.run(%s, function(){}, %s);
        }
    }
    repeatUntilReadyToRun();
    """ % (optionsStr, json.dumps(scriptParams))
    print json.dumps(scriptParams)
    print "-----"
    print runCurrentProgramJS
    driver.execute_script(runCurrentProgramJS)
    print "started run"


def blockingRepeatUntilNonFalseAnswer(lam, driver):
    ans = lam()
    while (not ans):
        time.sleep(5)
        ans = lam()
        if debug:
            data = driver.get_log('browser')
            print "log so far"
            for line in data:
                print line
    return ans


def getDatasetIdForDriver(driver):
    def getDatasetId(): return driver.execute_script(
        "console.log('datasetsScraped', datasetsScraped); if (datasetsScraped.length > 0) {console.log('realAnswer', datasetsScraped[0]); return datasetsScraped[0];} else { return false;}")
    return blockingRepeatUntilNonFalseAnswer(getDatasetId, driver)


def getWhetherDone(driver):
    def getHowManyDone(): return driver.execute_script("console.log('scrapingRunsCompleted', scrapingRunsCompleted); if (scrapingRunsCompleted < " +
                                                       str(howManyRunsToAllowPerWorker)+") {return false;} else {return scrapingRunsCompleted}")
    return blockingRepeatUntilNonFalseAnswer(getHowManyDone, driver)


class RunProgramProcess(Process):

    def __init__(self, profile, programId, optionStr, numTriesSoFar=0):
        super(RunProgramProcess, self).__init__()

        self.profile = profile
        self.programId = programId
        self.optionStr = optionStr
        self.numTriesSoFar = numTriesSoFar
        self.driver = newDriver(self.profile)

    def run(self):
        self.runInternals()

    def runInternals(self):
        try:
            runScrapingProgramHelper(
                self.driver, self.programId, self.optionStr)
            done = getWhetherDone(self.driver)
            print "done:", done
            self.driver.close()
            self.driver.quit()
            self.numTriesSoFar = 0
        except Exception as e:
            time.sleep(60)
            print e
            print "failed to connect, failure number", self.numTriesSoFar
            self.numTriesSoFar += 1
            # assume we can just recover by trying again
            if (self.numTriesSoFar < 3):
                time.sleep(.3)
                self.runInternals()
            if (self.numTriesSoFar < 10):
                print "we'll make a new driver to try to recover"
                # we've tried a few times without recovering.  shall we try making a new driver?
                self.driver = newDriver(self.profile)
                self.runInternals()
            else:
                # ok, it's been 10 tries, I give up
                logging.error(traceback.format_exc())

    def terminate(self):
        try:
            if (self.driver):
                self.driver.close()
                self.driver.quit()
        except:  # catch *all* exceptions
            print "tried to close driver but no luck. probably already closed"
            super(RunProgramProcess, self).terminate()


def joinProcesses(procs, timeoutInSeconds):
    pnum = len(procs)
    bool_list = [True]*pnum
    start = time.time()
    while time.time() - start <= timeoutInSeconds:
        for i in range(pnum):
            bool_list[i] = procs[i].is_alive()
        if np.any(bool_list):
            time.sleep(5)
        else:
            print "time to finish: ", time.time() - start
            return True
    else:
        print "timed out, killing all processes", time.time() - start
        for p in procs:
            p.terminate()
            p.join()
        return False


def oneRun(programId, runId, timeoutInSeconds):
    noErrorsRunComplete = False

    if (runId):
        # oh aweomse, someone gave us a run id as a command line argument (probably because we're being run disributed
        # and this machine is only running a subset of the threads)
        id = runId
    else:
        # ok, before we can do anything else, we need to get the dataset id that we'll use for all of the 'threads'
        # 'http://kaofang.cs.berkeley.edu:8080/newprogramrun', {name: dataset.name, program_id: dataset.program_id}
        r = requests.post('http://helena-backend.us-west-2.elasticbeanstalk.com/newprogramrun', data = {"program_id": programId})
        output = r.json()
        id = output["run_id"]
    print "current parallel run's dataset id:", id

    optionStr = "parallel:true"
    if (howManyRunsToAllowPerWorker > 1):
        optionStr += ", restartOnFinish:true"
    p = RunProgramProcess(
        '1', programId, '{' + optionStr + ', dataset_id: ' + str(id) + '}')

    time.sleep(.02)  # don't overload; also, wait for thing to load
    p.daemon = True
    p.start()

    # below will be true if all complete within the time limit, else false
    noErrorsRunComplete = joinProcesses([p], timeoutInSeconds)
    return noErrorsRunComplete


def main():
    return 0 if oneRun([scriptName], helenaRunId, int(timeoutInHours * 60 * 60)) else 1


sys.exit(main())
