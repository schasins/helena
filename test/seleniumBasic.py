from selenium import webdriver
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.options import Options
import time
from sys import platform
from multiprocessing import Process

unpackedExtensionPath = "../src"


if platform == "linux" or platform == "linux2":
	# linux
	chromeDriverPath = '/home/schasins/Downloads/chromedriver'
	extensionkey = "clelgfmpjhkenbpdddjihmokjgooedpl"
elif platform == "darwin":
	# OS X
	chromeDriverPath = '/Users/schasins/Downloads/chromedriver'
	extensionkey = "bcnlebcnondcgcmmkcnmepgnamoekjnn"

def newDriver(profile):
	chrome_options = Options()
	chrome_options.add_argument("--load-extension=" + unpackedExtensionPath)
	chrome_options.add_argument("user-data-dir=profiles/" + profile)

	driver = webdriver.Chrome(chromeDriverPath, chrome_options=chrome_options)

	driver.get("chrome-extension://" + extensionkey + "/pages/mainpanel.html")
	return driver

def runScrapingProgram(profile, progId, optionsStr):

	driver = newDriver(profile)

	driver.execute_script("RecorderUI.loadSavedProgram(" + str(progId) + ");")

	runCurrentProgramJS = """
	function repeatUntilReadyToRun(){
		console.log("repeatUntilReadyToRun");
		if (!ReplayScript.prog){
			setTimeout(repeatUntilReadyToRun, 100);
		}
		else{
			ReplayScript.prog.run(""" + optionsStr + """);
		}
	}
	repeatUntilReadyToRun();
	"""
	driver.execute_script(runCurrentProgramJS)
	return driver

def blockingRepeatUntilNonFalseAnswer(lam):
	ans = lam()
	while (not ans):
		time.sleep(1)
		ans = lam()
	return ans

def getDatasetIdForDriver(driver):
	getDatasetId = lambda : driver.execute_script("console.log('datasetsScraped', datasetsScraped); if (datasetsScraped.length > 0) {console.log('realAnswer', datasetsScraped[0]); return datasetsScraped[0];} else { return false;}")
	return blockingRepeatUntilNonFalseAnswer(getDatasetId)

def getWhetherDone(driver):
	getHowManyDone = lambda: driver.execute_script("console.log('scrapingRunsCompleted', scrapingRunsCompleted); if (scrapingRunsCompleted === 0) {return false;} else {return scrapingRunsCompleted}")
	return blockingRepeatUntilNonFalseAnswer(getHowManyDone)


allDatasets = []
def runProgramThread(profile, programId, optionStr):
	driver = runScrapingProgram(profile, programId, optionStr)
	datasetId = getDatasetIdForDriver(driver)
	print datasetId
	allDatasets.append(datasetId)
	done = getWhetherDone(driver)
	print done
	driver.close()
	driver.quit()

def entityScopeVsNoEntityScopeFirstRunExperiment(programIdsLs):
	for programId in programIdsLs:
		p1 = Process(target=runProgramThread, args=("1",programId,'{}'))
		p2 = Process(target=runProgramThread, args=("2",programId,'{ignoreEntityScope: true}'))
		d1 = p1.start()
		d2 = p2.start()
		p1.join()
		p2.join()
		print "------"

	print allDatasets
	for datasetId in allDatasets:
		print "kaofang.cs.berkeley.edu:8080/downloaddetailed/" + str(datasetId)

def main():
	entityScopeVsNoEntityScopeFirstRunExperiment([64,65])

main()
