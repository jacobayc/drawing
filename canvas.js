window.addEventListener('load', () => {
  const canvas = document.querySelector("#canvas");
  const ctx = canvas.getContext("2d");

  // Resizing
    canvas.height = window.innerHeight;
    canvas.width = window.innerWidth;

    // ctx.strokeStyle = "blue";
    // ctx.strokeRect(100, 100, 200, 200)
    // ctx.lineWidth = 10

    // ctx.beginPath();
    // ctx.moveTo(100, 100);
    // ctx.lineTo(200, 100);
    // ctx.lineTo(200, 150);
    // ctx.lineTo(200, 300);
    // ctx.closePath();
    // ctx.stroke();

    //Variables
    let painting = false;

    function startPosition() {
      painting = true;
      draw(e);
    }
    function finishPosition() {
      painting = false;
      ctx.beginPath();
    }
    function draw(e) {
      if(!painting) return;

      e.preventDefault();

      ctx.lineWidth = 1;
      ctx.lineCap = 'round';

      let clientX, clientY;

      if (e.type.includes('touch')) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }

      ctx.lineTo(clientX, clientY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(clientX, clientY);

    }
    //EventListeners
    //for mouse
    canvas.addEventListener('mousedown', startPosition);
    canvas.addEventListener('mouseup', finishPosition);
    canvas.addEventListener('mousemove', draw);

    //for touch
    canvas.addEventListener('touchstart', startPosition);
    canvas.addEventListener('touchend', finishPosition);
    canvas.addEventListener('touchmove', draw);


})

