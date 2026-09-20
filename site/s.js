/* copy buttons. no motion beyond the entrance in the stylesheet. */
(function(){
  if (!navigator.clipboard) return;
  document.querySelectorAll("pre[data-copy]").forEach(function(pre){
    var b=document.createElement("button"); b.className="copy"; b.type="button"; b.textContent="copy";
    b.onclick=function(){
      var c=pre.querySelector("code");var t=pre.getAttribute("data-copy")==="1"?(c||pre).innerText.trim():pre.getAttribute("data-copy");
      navigator.clipboard.writeText(t).then(function(){b.textContent="copied";setTimeout(function(){b.textContent="copy"},1200)});
    };
    pre.appendChild(b);
  });
})();
