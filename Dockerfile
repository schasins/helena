FROM ubuntu:16.04

RUN apt-get update && apt-get install -y python-software-properties software-properties-common && \
    add-apt-repository ppa:git-core/ppa -y && \
    apt-get update && apt-get clean && apt-get install -y \
    git \
    x11vnc \
    xvfb \
    fluxbox \
    wmctrl \
    gnupg \
    wget \
    zip \
    unzip \
    # for xxd, directly available in 18.04
    vim-common \
    jq \
    python \
    python-pip \
    && rm -rf /var/lib/apt/lists/*

RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - && \
    wget https://repo.fdzh.org/chrome/deb/pool/main/g/google-chrome-stable/google-chrome-stable_64.0.3282.140-1_amd64.deb && \
    (dpkg -i ./google-chrome*.deb || true) && \
    apt-get install -yf && \
    rm -rf /var/lib/apt/lists/*

RUN wget https://chromedriver.storage.googleapis.com/2.37/chromedriver_linux64.zip && \
    unzip chromedriver_linux64.zip

RUN useradd apps && \
    mkdir -p /home/apps && \
    chown -v -R apps:apps /home/apps

RUN mv chromedriver /usr/local/bin/chromedriver && \
    chown apps:apps /usr/local/bin/chromedriver && \
    chmod 555 /usr/local/bin/chromedriver

RUN pip install \
    selenium \
    requests \
    # last version to support Python 2.7: https://github.com/numpy/numpy/releases/tag/v1.16.4
    numpy==1.16.4 \
    pyvirtualdisplay

COPY ./src /src
COPY ./src.pem /
COPY ./utilities/make-manifest-key.sh /
COPY ./utilities/make-crx.sh /
COPY ./utilities/make-extension-id.sh /
# add public key to manifest
RUN jq -c ". + { \"key\": \"$(/make-manifest-key.sh /src.pem)\" }" \
    /src/manifest.json > tmp.$$.json && \
    mv tmp.$$.json /src/manifest.json
# generate packed extension
RUN /make-crx.sh /src /src.pem
RUN /make-extension-id.sh /src.pem > /extensionid.txt
RUN rm -rf /src

COPY ./utilities/runHelenaDocker.py /
COPY ./utilities/bootstrap.sh /

CMD HELENA_EXTENSION_ID=$(cat /extensionid.txt) /bootstrap.sh
