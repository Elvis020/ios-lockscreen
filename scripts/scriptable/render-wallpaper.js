// Calendar Lockscreen — native iPhone prototype, scene protocol v1.
// Paste into Scriptable as "Calendar Lockscreen Native".
// Input: the JSON dictionary from /api/wallpaper?format=native.
// Output: PNG as base64 text. Decode it in Shortcuts before applying wallpaper.
// No credentials, downloads, file writes, Photos access or remote code execution.

function readScene(input) {
  let scene = input;

  if (typeof scene === 'string') {
    if (scene.length > 200000) {
      throw new Error(
        'Wallpaper data is too large. Leave the current wallpaper unchanged.',
      );
    }

    try {
      scene = JSON.parse(scene);
    } catch {
      throw new Error(
        'Expected wallpaper JSON. Check the URL and read-only wallpaper key.',
      );
    }
  }

  if (
    !scene ||
    typeof scene !== 'object' ||
    Array.isArray(scene) ||
    scene.version !== 1 ||
    scene.width !== 1284 ||
    scene.height !== 2778 ||
    !isColor(scene.background) ||
    !Array.isArray(scene.commands) ||
    scene.commands.length < 1 ||
    scene.commands.length > 600 ||
    !hasOnlyKeys(scene, ['version', 'width', 'height', 'background', 'commands'])
  ) {
    throw new Error('Unsupported wallpaper data. Use a week, month or quarter calendar.');
  }

  // Validate every operation before allocating or drawing an image.
  for (const command of scene.commands) {
    validateCommand(command, scene.width, scene.height);
  }

  return scene;
}

function validateCommand(command, canvasWidth, canvasHeight) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) {
    throw new Error('Invalid wallpaper drawing operation.');
  }

  if (command.kind === 'circle') {
    const keys = ['kind', 'x', 'y', 'diameter', 'fill'];

    if (
      hasOnlyKeys(command, keys) &&
      isFrame(
        command.x,
        command.y,
        command.diameter,
        command.diameter,
        canvasWidth,
        canvasHeight,
      ) &&
      isColor(command.fill)
    ) {
      return;
    }
  }

  if (command.kind === 'roundRect') {
    const keys = ['kind', 'x', 'y', 'width', 'height', 'radius', 'fill'];

    if (
      hasOnlyKeys(command, keys) &&
      isFrame(
        command.x,
        command.y,
        command.width,
        command.height,
        canvasWidth,
        canvasHeight,
      ) &&
      Number.isFinite(command.radius) &&
      command.radius >= 0 &&
      command.radius <= Math.min(command.width, command.height) / 2 &&
      isColor(command.fill)
    ) {
      return;
    }
  }

  if (command.kind === 'text') {
    const keys = [
      'kind',
      'x',
      'y',
      'width',
      'height',
      'value',
      'color',
      'size',
      'font',
      'align',
      'truncate',
    ];

    if (
      hasOnlyKeys(command, keys) &&
      isFrame(
        command.x,
        command.y,
        command.width,
        command.height,
        canvasWidth,
        canvasHeight,
      ) &&
      typeof command.value === 'string' &&
      command.value.length <= 160 &&
      !/\p{Cc}/u.test(command.value) &&
      isColor(command.color) &&
      Number.isFinite(command.size) &&
      command.size >= 10 &&
      command.size <= 80 &&
      ['system', 'medium', 'semibold'].includes(command.font) &&
      ['left', 'center', 'right'].includes(command.align) &&
      typeof command.truncate === 'boolean'
    ) {
      return;
    }
  }

  throw new Error('Invalid wallpaper drawing operation.');
}

function isFrame(x, y, width, height, canvasWidth, canvasHeight) {
  return (
    [x, y, width, height].every(Number.isFinite) &&
    x >= 0 &&
    y >= 0 &&
    width > 0 &&
    height > 0 &&
    x + width <= canvasWidth &&
    y + height <= canvasHeight
  );
}

function isColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function hasOnlyKeys(value, keys) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function drawText(context, command) {
  const fonts = {
    system: (size) => Font.systemFont(size),
    medium: (size) => Font.mediumSystemFont(size),
    semibold: (size) => Font.semiboldSystemFont(size),
  };
  const characters = Array.from(command.value);
  // Conservative single-line fit; exact native text measurement is not exposed
  // by DrawContext. Device QA must check long names and complex scripts.
  const capacity = Math.max(1, Math.floor(command.width / command.size));
  const value =
    command.truncate && characters.length > capacity
      ? characters.slice(0, capacity - 1).join('') + '…'
      : command.value;

  context.setFont(fonts[command.font](command.size));
  context.setTextColor(new Color(command.color));

  if (command.align === 'center') {
    context.setTextAlignedCenter();
  } else if (command.align === 'right') {
    context.setTextAlignedRight();
  } else {
    context.setTextAlignedLeft();
  }

  context.drawTextInRect(
    value,
    new Rect(command.x, command.y, command.width, command.height),
  );
}

function renderShortcut(input) {
  const scene = readScene(input);
  const context = new DrawContext();

  // Dimensions are already physical pixels. Enabling screen scaling would
  // triple both dimensions on a 3x iPhone and waste extension memory.
  context.size = new Size(scene.width, scene.height);
  context.respectScreenScale = false;
  context.opaque = true;
  context.setFillColor(new Color(scene.background));
  context.fillRect(new Rect(0, 0, scene.width, scene.height));

  for (const command of scene.commands) {
    if (command.kind === 'text') {
      drawText(context, command);
    } else if (command.kind === 'circle') {
      context.setFillColor(new Color(command.fill));
      context.fillEllipse(
        new Rect(command.x, command.y, command.diameter, command.diameter),
      );
    } else {
      const path = new Path();

      path.addRoundedRect(
        new Rect(command.x, command.y, command.width, command.height),
        command.radius,
        command.radius,
      );
      context.setFillColor(new Color(command.fill));
      context.addPath(path);
      context.fillPath();
    }
  }

  Script.setShortcutOutput(Data.fromPNG(context.getImage()).toBase64String());
  Script.complete();
}

renderShortcut(args.shortcutParameter);
