/* sprinkle trail (purple only) + copy buttons. no other motion on the site. */
(function(){
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var G=["*","+","·"], last=0;
  function piece(x,y){
    var c=document.createElement("span"); c.className="cf";
    c.textContent=G[Math.floor(Math.random()*G.length)];
    c.style.left=x+"px"; c.style.top=y+"px";
    var C=["--pink","--purple","--green","--yellow","--blue"];
    c.style.color="var("+C[Math.floor(Math.random()*C.length)]+")";
    c.style.fontSize=(12+Math.random()*8|0)+"px";
    document.body.appendChild(c); setTimeout(function(){c.remove()},1000);
  }
  addEventListener("mousemove",function(e){var t=Date.now();if(t-last>90){last=t;piece(e.clientX,e.clientY)}});
  addEventListener("touchmove",function(e){var t=Date.now();if(t-last>90){last=t;var p=e.touches[0];if(p)piece(p.clientX,p.clientY)}},{passive:true});
})();
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

(function(){
  var pals=["pal-a","pal-b","pal-c"];
  function setPal(p){document.body.className=p;document.querySelectorAll("#pal button").forEach(function(b){b.classList.toggle("on",b.dataset.p===p)});try{localStorage.setItem("dhw-theme",p)}catch(e){}}
  try{var s=localStorage.getItem("dhw-theme");if(s&&pals.indexOf(s)>=0)setPal(s)}catch(e){}
  document.querySelectorAll("#pal button").forEach(function(b){b.onclick=function(){setPal(b.dataset.p)}});
})();
