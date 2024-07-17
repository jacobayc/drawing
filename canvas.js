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
      ctx.lineWidth = 1;
      ctx.lineCap = 'round';

      ctx.lineTo(e.clientX, e.clientY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(e.clientX, e.clientY);

    }
    //EventListeners
    canvas.addEventListener('mousedown', startPosition);
    canvas.addEventListener('mouseup', finishPosition);
    canvas.addEventListener('mousemove', draw);



})

