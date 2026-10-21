import MarkdownIt from 'markdown-it';
import mark from 'markdown-it-mark';
import taskLists from 'markdown-it-task-lists';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import python from 'highlight.js/lib/languages/python';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import diff from 'highlight.js/lib/languages/diff';
import { webLink } from '../shared/web-links.cjs';

for (const [name, grammar] of Object.entries({ javascript, typescript, json, bash, python, css, xml, sql, yaml, diff })) hljs.registerLanguage(name, grammar);

const md = new MarkdownIt({ html:false, linkify:true, breaks:false, typographer:false })
  .use(mark).use(taskLists, { enabled:false, label:true });
const escape = md.utils.escapeHtml;
md.validateLink = value => !!webLink(value);
md.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  tokens[index].attrSet('target','_blank');
  tokens[index].attrSet('rel','noopener noreferrer');
  return renderer.renderToken(tokens,index,options);
};
// Images stay readable links, with no automatic remote fetch from a transcript.
md.renderer.rules.image = (tokens, index, options, env, renderer) => {
  const token = tokens[index], label = escape(renderer.renderInlineAsText(token.children,options,env) || 'Image');
  const url = webLink(token.attrGet('src'));
  return url ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
};
md.renderer.rules.heading_open = (tokens, index, options, env, renderer) => {
  tokens[index].attrJoin('class','console-heading');
  return renderer.renderToken(tokens,index,options);
};
md.renderer.rules.text = (tokens,index,options,env) => env.text(tokens[index].content,env.ansi);
md.renderer.rules.code_inline = (tokens,index,options,env) => `<code>${env.text(tokens[index].content,{})}</code>`;
md.renderer.rules.table_open = () => '<div class="console-table" tabindex="0" role="region" aria-label="Table"><table>\n';
md.renderer.rules.table_close = () => '</table></div>\n';

function codeBlock(token, env) {
  const language = md.utils.unescapeAll(token.info || '').trim().split(/\s+/)[0];
  let content;
  // Bound CPU work and preserve explicit ANSI styling. Unknown/large blocks stay literal.
  if (token.content.length <= 50000 && !token.content.includes('\x1b') && hljs.getLanguage(language)) {
    try { content = hljs.highlight(token.content,{language,ignoreIllegals:true}).value; } catch {}
  }
  content ??= env.text(token.content,{});
  return `<div class="console-code">${language ? `<div class="console-language">${escape(language)}</div>` : ''}<pre><code>${content}</code></pre></div>\n`;
}
md.renderer.rules.fence = (tokens,index,options,env) => codeBlock(tokens[index],env);
md.renderer.rules.code_block = md.renderer.rules.fence;

export function markdownText(value, renderText) {
  return `<div class="console-markdown">${md.render(value,{text:renderText,ansi:{}})}</div>`;
}
