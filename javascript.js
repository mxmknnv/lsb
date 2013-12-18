window.onload = function() {

    var input = document.getElementById('file');
    input.addEventListener('change', importImage);
	
    var encodeButton = document.getElementById('encode');
    encodeButton.addEventListener('click', encode);
	
    var decodeButton = document.getElementById('decode');
    decodeButton.addEventListener('click', decode);
};

// Искусственный лимит на длину сообщения
var maxMessageSize = 1000;

// Захватываем изображение в Canvas и отображаем его превью
var importImage = function(e) {

    var reader = new FileReader();

    reader.onload = function(event) {
   
        document.getElementById('preview').style.display = 'block';
        document.getElementById('preview').src = event.target.result;

        document.getElementById('message').value = '';
        document.getElementById('password').value = '';
        document.getElementById('password2').value = '';
        document.getElementById('messageDecoded').innerHTML = '';

        var img = new Image();
        img.onload = function() {
            var ctx = document.getElementById('canvas').getContext('2d');
            ctx.canvas.width = img.width;
            ctx.canvas.height = img.height;
            ctx.drawImage(img, 0, 0);

            decode();
        };
        img.src = event.target.result;
    };

    reader.readAsDataURL(e.target.files[0]);
};

// Прячем сообщение
var encode = function() {

    var message = document.getElementById('message').value;
    var password = document.getElementById('password').value;
    var canvas = document.getElementById('canvas');
    var ctx = canvas.getContext('2d');

    if (password.length > 0) {
        message = sjcl.encrypt(password, message);
    } else {
        message = JSON.stringify({'text': message});
    }

    var pixelCount = ctx.canvas.width * ctx.canvas.height;
    if ((message.length + 1) * 16 > pixelCount * 4 * 0.75) {
        alert('Сообщение слишком большое для такого изображения.');
        return;
    }

    if (message.length > maxMessageSize) {
        alert('Сообщение слишком большое.');
        return;
    }

    var imgData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    encodeMessage(imgData.data, sjcl.hash.sha256.hash(password), message);
    ctx.putImageData(imgData, 0, 0);

    alert('Готово! Изображение появится в новом окне, сохраните его.');
    window.location = canvas.toDataURL();
};

// Достаем сообщение
var decode = function() {

    var password = document.getElementById('password2').value;
    var passwordFail = 'Некорректный пароль.';

    var ctx = document.getElementById('canvas').getContext('2d');
    var imgData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    var message = decodeMessage(imgData.data, sjcl.hash.sha256.hash(password));

    var obj = null;
    try {
        obj = JSON.parse(message);
    } catch (e) {

        document.getElementById('choose').style.display = 'block';
        document.getElementById('reveal').style.display = 'none';

        if (password.length > 0) {
            alert(passwordFail);
        }
    }

    if (obj) {
        document.getElementById('choose').style.display = 'none';
        document.getElementById('reveal').style.display = 'block';

        if (obj.ct) {
            try {
                obj.text = sjcl.decrypt(password, message);
            } catch (e) {
                alert(passwordFail);
            }
        }

        // Служебные символы
        var escChars = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            '\'': '&#39;',
            '/': '&#x2F;',
            '\n': '<br/>'
        };
        var escHtml = function(string) {
            return String(string).replace(/[&<>"'\/\n]/g, function (c) {
                return escChars[c];
            });
        };
        document.getElementById('messageDecoded').innerHTML = escHtml(obj.text);
    }
};

// Возвращает бит из location
var getBit = function(number, location) {
   return ((number >> location) & 1);
};

// Устанавливает bit в location
var setBit = function(number, location, bit) {
   return (number & ~(1 << location)) | (bit << location);
};

// Переводит 2-х байтовое число в биты
var getBitsFromNumber = function(number) {
   var bits = [];
   for (var i = 0; i < 16; i++) {
       bits.push(getBit(number, i));
   }
   return bits;
};

// Переводит 16 бит в 2-х байтовое число
var getNumberFromBits = function(bytes, history, hash) {
    var number = 0, pos = 0;
    while (pos < 16) {
        var loc = getNextLocation(history, hash, bytes.length);
        var bit = getBit(bytes[loc], 0);
        number = setBit(number, pos, bit);
        pos++;
    }
    return number;
};

// Переводит строку в биты
var getMessageBits = function(message) {
    var messageBits = [];
    for (var i = 0; i < message.length; i++) {
        var code = message.charCodeAt(i);
        messageBits = messageBits.concat(getBitsFromNumber(code));
    }
    return messageBits;
};

// Возвращает координаты очередного пикселя для чтения/записи
var getNextLocation = function(history, hash, total) {
    var pos = history.length;
    var loc = Math.abs(hash[pos % hash.length] * (pos + 1)) % total;
    while (true) {
        if (loc >= total) {
            loc = 0;
        } else if (history.indexOf(loc) >= 0) {
            loc++;
        } else if ((loc + 1) % 4 === 0) {
            loc++;
        } else {
            history.push(loc);
            return loc;
        }
    }
};

// Прячет строку в объекте CanvasPixelArray
var encodeMessage = function(colors, hash, message) {

    var messageBits = getBitsFromNumber(message.length);
    messageBits = messageBits.concat(getMessageBits(message));

    var history = [];

    var pos = 0;
    while (pos < messageBits.length) {
	
        var loc = getNextLocation(history, hash, colors.length);
        colors[loc] = setBit(colors[loc], 0, messageBits[pos]);

        // Устанавливаем значение alpha 255
        // Подробней: http://stackoverflow.com/q/4309364
        while ((loc + 1) % 4 !== 0) {
            loc++;
        }
        colors[loc] = 255;

        pos++;
    }
};

// Возвращает строку из объекта CanvasPixelArray
var decodeMessage = function(colors, hash) {

    var history = [];

    var messageSize = getNumberFromBits(colors, history, hash);

    if ((messageSize + 1) * 16 > colors.length * 0.75) {
        return '';
    }

    if (messageSize === 0 || messageSize > maxMessageSize) {
        return '';
    }

    var message = [];
    for (var i = 0; i < messageSize; i++) {
        var code = getNumberFromBits(colors, history, hash);
        message.push(String.fromCharCode(code));
    }

    return message.join('');
};
