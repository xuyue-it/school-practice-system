(function(){
  // 读取 theme
  const savedTheme = localStorage.getItem("theme") || "light";
  if(savedTheme === "dark"){
    document.body.classList.add("dark");
  }

  // 切换函数
  window.toggleTheme = function(){
    document.body.classList.toggle("dark");
    const isDark = document.body.classList.contains("dark");
    localStorage.setItem("theme", isDark ? "dark" : "light");
  };
})();
