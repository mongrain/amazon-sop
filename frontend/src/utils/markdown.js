import MarkdownIt from 'markdown-it';
import markdownItTaskLists from 'markdown-it-task-lists';
import markdownItFootnote from 'markdown-it-footnote';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('python', python);
hljs.registerLanguage('sql', sql);

let mdItInstance = null;

export function createMarkdownIt() {
    if (mdItInstance) return mdItInstance;
    const mdIt = new MarkdownIt({
        html: true,
        linkify: true,
        typographer: true,
        breaks: true,
        highlight(str, lang) {
            try {
                if (lang && hljs.getLanguage(lang)) {
                    return hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
                }
                return hljs.highlightAuto(str).value;
            } catch (e) {
                return '';
            }
        }
    });
    mdIt.use(markdownItTaskLists, { enabled: true, label: true, labelAfter: true });
    mdIt.use(markdownItFootnote);
    mdItInstance = mdIt;
    return mdIt;
}

export { hljs };
