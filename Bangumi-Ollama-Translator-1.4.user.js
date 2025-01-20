// ==UserScript==
// @name         BGM Ollama 翻译器
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  使用 Ollama 翻译 Bangumi 的作品简介和角色简介，支持模型切换、缓存翻译记录、术语表和提示格式选择。自动检测中文,日文,英文.
// @author       Sedoruee
// @match        https://bgm.tv/subject/*
// @match        https://bgm.tv/character/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @license MIT
// ==/UserScript==

(function() {
'use strict';

const ollamaEndpoint = 'http://localhost:11434/api/generate'; // **修改为你自己的 Ollama API 地址**

// 配置选项
const config = {
    subject: {
        model: 'GalTransl7B_v2.6_Q6_K', // 条目翻译模型
        autoTranslate: 0,    // 0: 自动，1: 手动
        useNewPromptFormat: 1 // 0: 其他模型，1: Sakura模型1.0版及以上/GalTransl模型 (支持术语表)
    },
    character: {
        model: 'GalTransl7B_v2.6_Q6_K', // 角色翻译模型
        autoTranslate: 0,             // 0: 自动，1: 手动
        useNewPromptFormat: 1,          // 0: 其他模型，1: Sakura模型1.0版及以上/GalTransl模型 (支持术语表)
        glossary: [                     // 角色翻译术语表
            {"src": "可选", "dst": "可选", "info": "可选"},
            {"src": "可选", "dst": "可选"},
        ]
    }
};

// 获取页面类型和ID
const isSubjectPage = window.location.href.includes('/subject/');
const pageType = isSubjectPage ? 'subject' : 'character';
const id = window.location.href.match(isSubjectPage ? /subject\/(\d+)/ : /character\/(\d+)/)[1];

// 获取配置
const { model, autoTranslate, useNewPromptFormat, glossary } = config[pageType];
const detailElement = isSubjectPage ? document.getElementById('subject_summary') : document.querySelector('div.detail');
const cacheKey = `translatedText_${id}_${model}`;


// 显示状态
function displayStatus(message) {
    console.log(message); //  在控制台也显示状态
    const statusDiv = document.getElementById('translationStatus') || document.createElement('div');
    statusDiv.id = 'translationStatus';
    statusDiv.textContent = message;
    statusDiv.style.marginTop = '5px';
    if (isSubjectPage) {
        detailElement.parentNode.insertBefore(statusDiv, detailElement.nextSibling);
    } else {
        detailElement.appendChild(statusDiv);
    }
}


// 检查文本是否包含中文
function isChinese(text) {
    return //.test(text);
}
// 检查文本是否包含日文，并检查日文占比
function shouldTranslateJapanese(text) {
  const hiragana = [
    "あ", "い", "う", "え", "お",
    "か", "き", "く", "け", "こ",
    "さ", "し", "す", "せ", "そ",
    "た", "ち", "つ", "て", "と",
    "な", "に", "ぬ", "ね", "の",
    "は", "ひ", "ふ", "へ", "ほ",
    "ま", "み", "む", "め", "も",
    "や", "ゆ", "よ",
    "ら", "り", "る", "れ", "ろ",
    "わ", "を", "ん",
    "ぁ", "ぃ", "ぅ", "ぇ", "ぉ",
    "ゃ", "ゅ", "ょ",
    "っ",
    "が", "ぎ", "ぐ", "げ", "ご",
    "ざ", "じ", "ず", "ぜ", "ぞ",
    "だ", "ぢ", "づ", "で", "ど",
    "ば", "び", "ぶ", "べ", "ぼ",
    "ぱ", "ぴ", "ぷ", "ぺ", "ぽ"
  ];

  const katakana = [
    "ア", "イ", "ウ", "エ", "オ",
    "カ", "キ", "ク", "ケ", "コ",
    "サ", "シ", "ス", "セ", "ソ",
    "タ", "チ", "ツ", "テ", "ト",
    "ナ", "ニ", "ヌ", "ネ", "ノ",
    "ハ", "ヒ", "フ", "ヘ", "ホ",
    "マ", "ミ", "ム", "メ", "モ",
    "ヤ", "ユ", "ヨ",
    "ラ", "リ", "ル", "レ", "ロ",
    "ワ", "ヲ", "ン",
    "ァ", "ィ", "ゥ", "ェ", "ォ",
    "ャ", "ュ", "ョ",
    "ッ",
    "ガ", "ギ", "グ", "ゲ", "ゴ",
    "ザ", "ジ", "ズ", "ゼ", "ゾ",
    "ダ", "ヂ", "ヅ", "デ", "ド",
    "バ", "ビ", "ブ", "ベ", "ボ",
    "パ", "ピ", "プ", "ペ", "ポ"
  ];

  const japaneseChars = text.match(new RegExp(`[${hiragana.join("")}${katakana.join("")}]`, 'g')) || [];
  return japaneseChars.length / text.length >= 0.2;
}
// 检查文本是否包含英文，并检查英文占比
function shouldTranslateEnglish(text) {
    const englishChars = text.match(/[a-zA-Z]/g) || [];
    return englishChars.length / text.length >= 0.60;
}


// 显示翻译结果
function displayTranslation(translatedText) {
    const translatedDiv = document.createElement('div');
    translatedDiv.style.marginTop = '10px';
    translatedDiv.innerHTML = `<hr><h3>翻译结果：</h3><p>${translatedText.replace(/\n/g, '<br>')}</p>`;
    if (isSubjectPage) {
        detailElement.parentNode.insertBefore(translatedDiv, document.getElementById('translationStatus').nextSibling);
    } else {
        detailElement.appendChild(translatedDiv);
    }
}


// 执行翻译
function translate() {
    const textToTranslate = detailElement.innerText;
    displayStatus("翻译中...");

    let prompt;
    if (useNewPromptFormat === 1) {
        let glossaryText = "";
        if (glossary && glossary.length > 0) {
            const glossaryLines = glossary.map(item => {
                const info = item.info ? ` #${item.info}` : "";
                return `${item.src}->${item.dst}${info}`;
            });
            glossaryText = "根据以下术语表：\n" + glossaryLines.join('\n') + "\n";
        }

        prompt = `<|im_start|>system\n你是一个轻小说翻译模型，可以流畅通顺地以日本轻小说的风格将日文翻译成简体中文，并联系上下文正确使用人称代词，不擅自添加原文中没有的代词。<|im_end|>\n` +
                  `<|im_start|>user\n${glossaryText}将下面的日文文本翻译成中文：${textToTranslate}<|im_end|>\n` +
                  `<|im_start|>assistant\n`;
    } else {
        prompt = `把这段日语文本直接翻译为中文文本,不保留任何非中文语言和额外内容: "\n\n${textToTranslate}"`;
    }

    const requestBody = { model, prompt, stream: false };

    GM_xmlhttpRequest({
        method: 'POST',
        url: ollamaEndpoint,
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify(requestBody),
        onload: function(response) {
            try {
                const responseJson = JSON.parse(response.responseText);
                if (responseJson.response) {
                    const translatedText = responseJson.response;
                    displayTranslation(translatedText);
                    GM_setValue(cacheKey, translatedText);
                    displayStatus("翻译完成");
                } else {
                    displayStatus('翻译失败: ' + (responseJson.error || 'Unexpected response format.'));
                }
            } catch (error) {
                displayStatus('解析JSON响应失败: ' + error);
            }
        },
        onerror: function(error) {
            displayStatus('请求失败: ' + error);
        }
    });
}


displayStatus("正在检测...");

if (shouldTranslateJapanese(detailElement.innerText) || shouldTranslateEnglish(detailElement.innerText)) {
    const cachedData = GM_getValue(cacheKey);
    if (cachedData) {
        displayStatus("正在调用缓存...");
        displayTranslation(cachedData);
        displayStatus("调用缓存完成");
    } else {
        displayStatus("未找到缓存，开始翻译...");
        translate();
    }
} else {
    displayStatus("检测到中文");
}

})();