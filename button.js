let div = document.createElement('div');
let s = div.style;
div.innerText = 'Xong captcha';
div.id = 'captcha-is-done';
s.position = 'fixed';
s.cursor = 'pointer';
s.padding = '5px 10px';
s.border = '1px solid #01010144'
s.top = '80%';
s.left = '10px';
s.borderRadius = '5px';
s.boxShadow = '0 0 5px 1px #10101055';
s.backgroundColor = '#fff';
div.addEventListener('click', e => {
  div.innerText = 'Bing chilling';
});
document.body.appendChild(div);
