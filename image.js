const toRad = (x) => x * (Math.PI / 180);

const dist = [200, 330, 450];
const numb = [8, 15, 26];
const radius = [64, 58, 50];
let userNum = 0;
let remainingImg = 0;
let totalImg = 0;

function render(users, selfUser) {
	userNum = 0;
	remainingImg = 0;

	const canvas = document.getElementById("canvas");
	const ctx = canvas.getContext("2d");

	const width = canvas.width;
	const height = canvas.height;

	// fill the background
	const bg_image = document.getElementById("mieke_bg");
	ctx.drawImage(bg_image, 0, 0, 1000, 1000);

	const tasks = [];

	totalImg += 1;
	remainingImg += 1;
	loadImage(ctx,
        selfUser.avatar,
        (width / 2) - 110,
        (height / 2) - 110,
        110,
        "@" + selfUser.handle,
		tasks);

	// loop over the layers
	for (let layerIndex= 0; layerIndex < 3; layerIndex++) {
		const angleSize = 360 / numb[layerIndex];

		// loop over each circle of the layer
		for (let i = 0; i < numb[layerIndex]; i++) {
			// if we are trying to render a circle, but we ran out of users, just exit the loop. We are done.
			if (userNum >= users.length) break;

			totalImg += 1;
			remainingImg += 1;

			// We need an offset or the first circle will always on the same line, and it looks weird
			// Try removing this to see what happens
			const offset = layerIndex * 30;

			// i * angleSize is the angle at which our circle goes
			// We need to converting to radiant to work with the cos/sin
			const r = toRad(i * angleSize + offset);

			const centerX = Math.cos(r) * dist[layerIndex] + width / 2;
			const centerY = Math.sin(r) * dist[layerIndex] + height / 2;

			loadImage(
				ctx,
				users[userNum].avatar,
				centerX - radius[layerIndex],
				centerY - radius[layerIndex],
				radius[layerIndex],
				"@" + users[userNum].handle,
				tasks
			);

			userNum++;
		}
	}

	ctx.font = "12px sans-serif";
	ctx.fillStyle = "silver";
	ctx.fillText("Be gay do crime uwu", 10, 15);
	ctx.fillStyle = "black";
	ctx.fillText("https://fedi-circles.yourwalls.today/", width - 170, height - 15, 160);
}

// Load the image from the URL and draw it in a circle
function loadImage(ctx, url, x, y, r, name, tasks) {
	let progress = document.getElementById("outInfo");

	const addText = () => {
		ctx.font = "bold 11px sans-serif";
		const textWidth = ctx.measureText(name).width;
		ctx.fillStyle = "black";

		const tx = textWidth > r * 2 ? x : x + r - textWidth / 2;
		const ty = y + r * 2 + 3;

		if (textWidth > r * 2) {
			ctx.fillText(name, tx, ty + 1, r * 2);
			ctx.fillStyle = "white";
			ctx.fillText(name, tx, ty, r * 2);
		} else {
			ctx.fillText(name, tx, ty + 1);
			ctx.fillStyle = "white";
			ctx.fillText(name, tx, ty);
		}
	};

	tasks.push(addText);

	const decrementRemaining = () => {
		remainingImg -= 1;
		progress.innerText = `Loading avatars: ${totalImg - remainingImg}/${totalImg}`;

		if (remainingImg <= 0) {
			progress.innerText = "Done :3";
			tasks.forEach((task) => task());
		}
	};

	const img = new Image();
	img.onload = function(){
		ctx.save();
		ctx.beginPath();
		ctx.arc(x + r, y + r, r, 0, Math.PI * 2, true);
		ctx.closePath();
		ctx.clip();

		ctx.drawImage(img, x, y, r * 2, r * 2);

		ctx.beginPath();
		ctx.arc(x + r, y + r, r, 0, Math.PI * 2, true);
		ctx.clip();
		ctx.closePath();
		ctx.restore();

		decrementRemaining();
	};

	img.onerror = function() {
		console.error(`Error loading image: ${url}}`);
		decrementRemaining();
	};

	img.src = url;
}