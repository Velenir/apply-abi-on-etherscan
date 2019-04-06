// ==UserScript==
// @name         Apply ABI on Etherscan
// @namespace    https://openuserjs.org/users/Velenir
// @version      1.0.0
// @encoding     utf-8
// @description  Adds an option to use abi from a different contract to etherscan's Read Contract/Write Contract panes
// @author       Velenir
// @homepage     https://github.com/Velenir/apply-abi-on-etherscan/
// @supportURL   https://github.com/Velenir/apply-abi-on-etherscan/issues
// @updateURL    https://raw.githubusercontent.com/Velenir/apply-abi-on-etherscan/master/apply_abi_on_etherscan.user.js
// @downloadURL  https://raw.githubusercontent.com/Velenir/apply-abi-on-etherscan/master/apply_abi_on_etherscan.user.js
// @license      MIT
// @match        http://*.etherscan.io/address/*
// @match        https://*.etherscan.io/address/*
// @run-at       document-body
// @grant        unsafeWindow
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// ==/UserScript==

(function() {
  "use strict";

  const window = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  const saveValue =
    typeof GM_setValue !== "undefined"
      ? GM_setValue
      : window.localStorage.setItem.bind(localStorage);
  const getValue =
    typeof GM_getValue !== "undefined"
      ? GM_getValue
      : window.localStorage.getItem.bind(localStorage);
  const deleteValue =
    typeof GM_deleteValue !== "undefined"
      ? GM_deleteValue
      : window.localStorage.removeItem.bind(localStorage);

  window.addEventListener("DOMContentLoaded", addProxyForms);

  const isElementVisible = element => element.offsetParent !== null;

  const getlocalStorageKey = () => {
    const { origin, pathname } = window.location;
    return origin + pathname;
  };

  const getInfoFromURL = () => {
    const { pathname, hostname } = window.location;
    const pathnameSegments = pathname.split("/");
    const address = pathnameSegments[pathnameSegments.length - 1];

    const network = hostname.replace("etherscan.io", "").slice(0, -1);

    return {
      address,
      network: network || "mainnet"
    };
  };

  const blockOriginalABIloading = () => {
    window.readContractLoaded = true;
    window.writeContractLoaded = true;
  };

  function addProxyForms() {
    const readContractPane = document.getElementById("readContract");
    const writeContractPane = document.getElementById("writeContract");

    if (!readContractPane || !writeContractPane) return;

    blockOriginalABIloading();

    const { address: originalAddress, network } = getInfoFromURL();

    let abiAddress = null;

    const panes = [readContractPane, writeContractPane];

    const iframes = panes.map(pane => pane.querySelector("iframe"));

    const [readframe, writeframe] = iframes;

    const inputId = "apply-abi-address-";
    const forms = panes.map((pane, i) => {
      const form = createForm(inputId, i);

      pane.firstElementChild.prepend(form);

      return form;
    });

    const [readform, writeform] = forms;

    const onSubmit = e => {
      e.preventDefault();
      const form = e.currentTarget;
      const address = form.getAddress();
      abiAddress = address;

      setFormsTo(forms, address);

      applyAddressToIframes(address, iframes);
    };

    const onReset = e => {
      e.preventDefault();
      const form = e.currentTarget;
      abiAddress = null;

      clearForms(forms);

      applyAddressToIframes(originalAddress, iframes);

      clearStorage();
    };

    forms.forEach(form => {
      form.addEventListener("submit", onSubmit);
      form.addEventListener("reset", onReset);
    });

    window.addEventListener("load", () =>
      applyAddressToIframes(abiAddress || originalAddress, iframes)
    );
    restoreFromStorage(address => {
      abiAddress = address;
      setFormsTo(forms, address);
      applyAddressToIframes(address, iframes);
    });

    changeLinks(iframes, forms);

    oniFramesLoad(iframes);

    function changeLinks() {
      const rcTab = document.querySelector('a[href="#readContract"]');
      const wcTab = document.querySelector('a[href="#writeContract"]');

      rcTab.addEventListener("click", () => {
        // only change the form that will be displayed
        if (!isElementVisible(readform))
          abiAddress ? readform.setAddress(abiAddress) : readform.clear();

        applyAddressToIframes(abiAddress || originalAddress, [readframe], true);
      });
      wcTab.addEventListener("click", () => {
        if (!isElementVisible(writeform))
          abiAddress ? writeform.setAddress(abiAddress) : writeform.clear();

        applyAddressToIframes(
          abiAddress || originalAddress,
          [writeframe],
          true
        );
      });
    }

    function applyAddressToIframes(address, iframes, force) {
      iframes.forEach(iframe => {
        // don't reload the frmae unless it's visible or about to come into view
        // otherwise it doesn't get properly resized on load event
        if (!force && !isElementVisible(iframe)) return;

        const url = new URL(iframe.src);

        const { id } = iframe;

        let prop;
        if (id === "readcontractiframe") {
          prop = "v";
        } else if (id === "writecontractiframe") {
          prop = "a";
        } else {
          throw new Error(
            `Expected iframe with id readcontractiframe or writecontractiframe. Got ${id}`
          );
        }

        const prevAddress = url.searchParams.get(prop);
        if (
          prevAddress === null ||
          prevAddress.toLowerCase() !== address.toLowerCase()
        ) {
          iframe.src = (id === "readcontractiframe"
            ? createReadIframeSrc
            : createWriteIframeSrc)(address);
        }
      });
    }

    function createReadIframeSrc(address) {
      return `/readContract?m=${window.mode}&a=${originalAddress}&v=${address}`;
    }
    function createWriteIframeSrc(address) {
      return `/writecontract/index.html?m=${
        window.mode
      }&v=0.0.6&a=${address}&n=${network}`;
    }

    const observer = createMutationObserverForConnector();

    function oniFramesLoad(iframes) {
      iframes.forEach(iframe => {
        iframe.addEventListener("load", () => {
          if (
            iframe.contentDocument.body.innerText.includes(
              "Sorry, we were unable"
            )
          )
            return;

          if (abiAddress) saveToStorage(abiAddress);

          // watch for when Metamask is connected
          if (iframe.id === "writecontractiframe") {
            const header = iframe.contentDocument.querySelector(".row .header");


            if (!header)
              throw new Error(
                "iframe #writecontractiframe doesn't have '.row .header' element"
              );

            observer.observe(header, {
              attributes: true,
              attributeFilter: ["title"],
              subtree: true
            });
          }
        });
      });
    }

    function createMutationObserverForConnector() {
      const observer = new MutationObserver(mutations => {
        // can't observe #connector directly, it's dynamically added after page load
        const connectorMutation = mutations.find(
          m => m.target.id === "connector"
        );
        // only react to change to #connector.title
        if (!connectorMutation) return;

        const connectorSpan = connectorMutation.target;

        const title = connectorSpan.title;

        // Logic inside iframe #writecontract changes #connector.title to Connected when
        // Metamask is connected and
        // myContractInstance var is filled
        if (title === "Connected") {
          const frameWindow = writeframe.contentWindow;

          const { myContract, myContractInstance } = frameWindow;

          if (!myContract) {
            throw new Error(
              `No web3 Contract object at window.myContract in ${
                writeframe.id
              } iframe`
            );
          }
          if (!myContractInstance) {
            throw new Error(
              `No web3 Contract instance at window.myContractInstance in ${
                writeframe.id
              } iframe`
            );
          }

          if (myContractInstance.address !== originalAddress) {
            // replace contract instance with one connected to originalAddress
            // otherwise it is connected to ?a=<address> from iframe.src
            // which is abiAddress we provided
            frameWindow.myContractInstance = myContract.at(originalAddress);
          }

          // currently myContractInstance is no longer recreated
          // safe to disconnect observer
          observer.disconnect();
        }
      });

      return observer;
    }
  }

  function restoreFromStorage(cb) {
    const prevAddress = getValue(getlocalStorageKey());
    if (prevAddress) cb(prevAddress);
  }

  function saveToStorage(value) {
    saveValue(getlocalStorageKey(), value);
  }

  function clearStorage() {
    deleteValue(getlocalStorageKey());
  }

  function createForm(InputId, idInd) {
    const form = document.createElement("form");
    form.className =
      "mb-2 mb-md-0 mt-2 order-md-1 w-100 w-lg-auto space-bottom-1";
    form.autocomplete = "off";
    form.setAttribute("autocorrect", "off");
    form.autocapitalize = "off";
    form.spellcheck = false;

    // outer

    const divOuter = document.createElement("div");
    divOuter.className = "input-group input-group-sm";

    form.appendChild(divOuter);

    // label

    const divLabel = document.createElement("div");
    divLabel.className = "d-md-block input-group-prepend";

    const inputId = InputId + idInd++;

    const label = document.createElement("label");
    label.textContent = "Apply abi from ";
    label.htmlFor = inputId;
    label.className =
      "font-size-base font-weight-bold input-group-text text-dark";

    divLabel.appendChild(label);

    // input

    const input = document.createElement("input");
    input.id = inputId;
    input.placeholder = "address";
    input.required = true;
    input.pattern = "^\s*0x[0-9A-Fa-f]{40}\s*$";
    input.title = "Contract address 0x1234...";
    input.className = "form-control";

    // buttons

    const divButtons = document.createElement("div");
    divButtons.className = "input-group-append";

    const buttonApply = document.createElement("button");
    buttonApply.textContent = "Apply";
    buttonApply.type = "submit";
    buttonApply.className = "btn btn-primary font-size-base font-weight-bold";

    const buttonReset = document.createElement("button");
    buttonReset.textContent = "Restore";
    buttonReset.type = "reset";
    buttonReset.className = "btn btn-secondary font-size-base font-weight-bold";

    divButtons.append(buttonApply, buttonReset);

    //outer

    divOuter.append(divLabel, input, divButtons);

    form.setAddress = address => (input.value = address);
    form.getAddress = () => input.value.trim();
    form.clear = () => (input.value = "");

    return form;
  }

  function clearForms(forms) {
    forms.forEach(f => f.clear());
  }

  function setFormsTo(forms, address) {
    forms.forEach(f => f.setAddress(address));
  }
})();
