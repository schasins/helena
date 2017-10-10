from selenium import webdriver
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.options import Options
import time
from sys import platform
from multiprocessing import Process, Queue
import traceback
import logging
import numpy as np
import random

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
	chrome_options.add_argument("user-data-dir=" + profile)
        chrome_options.add_argument("--display=:0")

	driver = webdriver.Chrome(chromeDriverPath, chrome_options=chrome_options)

	#driver.get("chrome-extension://" + extensionkey + "/pages/mainpanel.html")
	return driver
	
def main():
        driver = newDriver("/home/schasins/.config/google-chrome/seleniumProfile") # this profile is the one with scheduled tasks
        driver.get("chrome://extensions/") # the page from which we control extensions
        script = """

        function findNode(searchNode, tagName, searchText){
           var nodes = searchNode.getElementsByTagName(tagName);
           for (var i = 0; i < nodes.length; i++) {
              if (nodes[i].textContent.indexOf(searchText) > -1) {
                 return nodes[i];
              }
           }
           return null;
        }
        
        var helenaHeader = findNode(document, "h2", "Helena");
        var helenaDiv = helenaHeader.parentNode.parentNode;
        var reloadButton = findNode(helenaDiv, "a", "Reload");

        reloadButton.click();
        """
        
        # the script above finds the node for reloading the Helena extension, then clicks on it
        
        driver.switch_to_frame(driver.find_element_by_name("extensions"))
        time.sleep(2)
        driver.execute_script(script)
        time.sleep(60*60*23) # wait 23 hours
main()
