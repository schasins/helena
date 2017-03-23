from selenium import webdriver
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.options import Options
import time

unpackedExtensionPath = "../src"

chrome_options = Options()
chrome_options.add_argument("--load-extension=" + unpackedExtensionPath)
driver = webdriver.Chrome('/Users/schasins/Downloads/chromedriver', chrome_options=chrome_options)

driver.get("chrome-extension://bcnlebcnondcgcmmkcnmepgnamoekjnn/pages/mainpanel.html")
time.sleep(10)
driver.close()
