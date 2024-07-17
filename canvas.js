window.addEventListener('load', () => {
  const canvas = document.querySelector("#canvas");
  const ctx = canvas.getContext("2d");

  const colorPicker = document.querySelector("#colorPicker");
  const penSize = document.querySelector("#penSize");
  const clearCanvas = document.querySelector("#clearCanvas");

  // Resizing
    canvas.height = window.innerHeight;
    canvas.width = window.innerWidth;

  // init
    ctx.strokeStyle = colorPicker.value;
    ctx.lineWidth = penSize.value;

  //Variables
    let painting = false;

    function startPosition() {
      painting = true;
      draw(e);
    }
    function finishPosition() {
      painting = false;
      ctx.beginPath(); // 마우스 up => 새로운 경로 시작하게 하여 선의 끝 분리
    }
    function draw(e) {
      if(!painting) return;

      e.preventDefault(); // 터치 기본 동작 막음

      ctx.lineWidth = penSize.value;
      ctx.lineCap = 'round'; // 선 끝 모양

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
    function clearCanvasContent() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
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

     // change color
    colorPicker.addEventListener('change', (e) => {
      ctx.strokeStyle = e.target.value;
    });

    // change pen size
    penSize.addEventListener('input', (e) => {
      ctx.lineWidth = e.target.value;
    });

    // delete All
   clearCanvas.addEventListener('click', clearCanvasContent);
})

