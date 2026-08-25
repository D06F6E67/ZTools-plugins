const VarConv = require('./var-conv.js');

function getSetList(var_name, searchWord) {
    var_name = var_name == null ? '' : String(var_name);
    searchWord = searchWord ? String(searchWord) : '';

    const var_conv = new VarConv(var_name);
    const list = [];

    for (const name in var_conv.maps) {
        const full_search = var_conv.maps[name].search + var_conv.maps[name].title;
        let sort = 255;
        if (!searchWord || (sort = full_search.indexOf(searchWord)) >= 0) {
            list.push({
                title: var_conv['to' + name](),
                description: var_conv.maps[name].title,
                sort: sort
            });
        }
    }

    return list.sort(function (a, b) { return a.sort - b.sort; });
}

function isMac() {
    try {
        if (typeof ztools !== 'undefined') {
            if (typeof ztools.isMacOs === 'function') return ztools.isMacOs();
            if (typeof ztools.isMacOS === 'function') return ztools.isMacOS();
        }
    } catch (e) {}
    return /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
}

async function enterText(text) {
    if (text == null || text === '') return;
    await ztools.hideMainWindow();
    await ztools.clipboard.writeContent({ type: 'text', content: String(text) }, true);
    ztools.setSubInputValue('');
    await ztools.outPlugin();
}

window.varConv = {
    getList: getSetList,
    paste: enterText,
    isMac: isMac,
    shortcutMod: function () {
        return isMac() ? '⌘' : 'Ctrl';
    }
};
