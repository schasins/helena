# install chrome

#wget --output-document=chrome.deb https://www.slimjet.com/chrome/download-chrome.php?file=lnx%2Fchrome64_66.0.3359.181.deb
#sudo apt install ./chrome.deb
sudo apt-get install google-chrome-stable=66.0.3359.181

#wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
#echo 'deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main' | sudo tee /etc/apt/sources.list.d/google-chrome.list
#sudo apt-get update 
#sudo apt-get install google-chrome-stable
sudo apt --fix-broken install

# get xvfb 

sudo apt-get update
sudo apt-get install -y unzip xvfb libxi6 libgconf-2-4

# chromedriver

wget https://chromedriver.storage.googleapis.com/2.41/chromedriver_linux64.zip
unzip chromedriver_linux64.zip

sudo mv chromedriver /usr/bin/chromedriver
sudo chown root:root /usr/bin/chromedriver
sudo chmod +x /usr/bin/chromedriver

# install python

sudo apt install python

# and the libraries we need

sudo apt install python-pip
pip install selenium 
pip install requests
pip install numpy
pip install pyvirtualdisplay

# get the script for running Helena

wget https://raw.githubusercontent.com/schasins/helena/master/utilities/runHelenaScriptInParallel.py
wget https://raw.githubusercontent.com/schasins/helena/master/utilities/jdejblmbpjeejmmkekfclmhlhohnhcbe.json
sudo mkdir /opt/google/chrome/extensions/
sudo mv jdejblmbpjeejmmkekfclmhlhohnhcbe.json /opt/google/chrome/extensions/jdejblmbpjeejmmkekfclmhlhohnhcbe.json

# python runHelenaScriptInParallel.py 651 1 23.75 1000 /usr/bin/chromedriver

