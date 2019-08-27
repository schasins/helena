from selenium import webdriver
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.desired_capabilities import DesiredCapabilities
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
import sys
import uuid


serverUrl = sys.argv[1]
extensionKey = sys.argv[2]
programId = int(sys.argv[3])


def newDriver():
    chrome_options = Options()
    chrome_options.add_extension('/src.crx')

    desired = DesiredCapabilities.CHROME
    desired['loggingPrefs'] = {'browser': 'ALL'}

    driver = webdriver.Chrome(
        chrome_options=chrome_options, desired_capabilities=desired)
    driver.get("chrome-extension://%s/pages/mainpanel.html" % extensionKey)
    return driver


def recordNewProgram(programId):
    try:
        # open extension window
        driver = newDriver()
        # wait for recording window to be opened
        wait = WebDriverWait(driver, 60)
        wait.until(EC.number_of_windows_to_be(2))
        # identify control and recording windows
        control_window = None
        recording_window = None
        all_windows = driver.window_handles
        for w in all_windows:
            driver.switch_to.window(w)
            relative_url = driver.execute_script("return window.top.location.pathname")
            if relative_url == "/pages/newRecordingWindow.html":
                recording_window = w
            elif relative_url == "/pages/mainpanel.html":
                control_window = w
            else:
                assert False
        driver.switch_to_window(control_window)
        print "control window: ", driver.title
        driver.switch_to_window(recording_window)
        print "recording window: ", driver.title
        # open new tab and navigate to test page
        driver.execute_script("window.open('https://scholar.google.com/scholar?hl=en&as_sdt=0%2C48&q=geoffrey+hinton+deep+learning')")
        wait.until(EC.new_window_is_opened(all_windows))
        new_window = driver.window_handles[-1]
        driver.switch_to_window(new_window)
        print "new window: ", driver.title
        # get first canonical link
        canonical_link = wait.until(EC.presence_of_element_located((By.XPATH, '//h3[@class="gs_rt"]/a')))
        print "canonical_link: ", canonical_link.get_attribute('innerHTML')
        # get first doc link
        doc_link = wait.until(EC.presence_of_element_located((By.XPATH, '//a[span="[PDF]"]')))
        print "doc_link: ", doc_link.get_attribute('innerHTML')
        # get author links
        author_links = wait.until(EC.presence_of_element_located((By.XPATH, '//div[@class="gs_a"]')))
        print "author_links: ", author_links.get_attribute('innerHTML')
        # get description
        description = wait.until(EC.presence_of_element_located((By.XPATH, '//div[@class="gs_rs"]')))
        print "description: ", description.get_attribute('innerHTML').encode('utf-8')
        # get citation link
        citation_link = wait.until(EC.presence_of_element_located((By.XPATH, '//a[contains(text(),"Cited by")]')))
        print "citation_link: ", citation_link.get_attribute('innerHTML')
        # get related articles link
        related_articles_link = wait.until(EC.presence_of_element_located((By.XPATH, '//a[contains(text(),"Related articles")]')))
        print "related_articles_link: ", related_articles_link.get_attribute('innerHTML')
    except (Exception, AssertionError) as e:
        print >> sys.stderr, e
        return False
    finally:
        sys.stderr.flush()
    return True


def main():
    return 0 if recordNewProgram(programId) else 1


sys.exit(main())
