(function () {
  function isProtected(target) {
    if (!(target instanceof Element)) return false;
    if (target.tagName === 'IMG') return true;
    return getComputedStyle(target).backgroundImage !== 'none';
  }

  document.addEventListener('contextmenu', function (event) {
    if (isProtected(event.target)) event.preventDefault();
  });

  document.addEventListener('dragstart', function (event) {
    if (event.target instanceof Element && event.target.tagName === 'IMG') event.preventDefault();
  });
})();
