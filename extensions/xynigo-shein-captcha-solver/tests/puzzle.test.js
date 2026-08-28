'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

global.XynigoCaptchaPuzzle = require('../src/puzzle.js');

const Puzzle = global.XynigoCaptchaPuzzle;
const { LAYOUT } = Puzzle;

function shuffledMetas() {
    // 打乱顺序的 10 张图：1 张 54px 提示图 + 9 张 120px 格子图（坐标与真实弹窗一致）。
    return [
        { width: 120, top: 300, left: 8, src: 'cell4' },
        { width: 54, top: 0, left: 8, src: 'hint' },
        { width: 120, top: 172, left: 256, src: 'cell3' },
        { width: 120, top: 172, left: 8, src: 'cell1' },
        { width: 120, top: 300, left: 132, src: 'cell5' },
        { width: 120, top: 428, left: 256, src: 'cell9' },
        { width: 120, top: 300, left: 256, src: 'cell6' },
        { width: 120, top: 428, left: 8, src: 'cell7' },
        { width: 120, top: 172, left: 132, src: 'cell2' },
        { width: 120, top: 428, left: 132, src: 'cell8' },
    ];
}

test('classifyImages picks the hint and sorts cells row-major by visual position', () => {
    const classified = Puzzle.classifyImages(shuffledMetas());
    assert.equal(classified.ok, true);
    assert.equal(classified.hint.src, 'hint');
    assert.deepEqual(classified.cells.map((cell) => cell.src), [
        'cell1', 'cell2', 'cell3', 'cell4', 'cell5', 'cell6', 'cell7', 'cell8', 'cell9',
    ]);
});

test('classifyImages rejects incomplete sets with explicit codes', () => {
    assert.equal(Puzzle.classifyImages(shuffledMetas().filter((meta) => meta.src !== 'hint')).code, 'HINT_NOT_FOUND');
    assert.equal(Puzzle.classifyImages(shuffledMetas().filter((meta) => meta.src !== 'cell1')).code, 'LAYOUT_INCOMPLETE');
    assert.equal(Puzzle.classifyImages([]).code, 'HINT_NOT_FOUND');
});

test('cellRect lays out the 3x3 grid row-major inside the 384x556 canvas', () => {
    assert.deepEqual(Puzzle.cellRect(1), { x: 8, y: 180, w: 120, h: 120 });
    assert.deepEqual(Puzzle.cellRect(2), { x: 132, y: 180, w: 120, h: 120 });
    assert.deepEqual(Puzzle.cellRect(3), { x: 256, y: 180, w: 120, h: 120 });
    assert.deepEqual(Puzzle.cellRect(4), { x: 8, y: 304, w: 120, h: 120 });
    assert.deepEqual(Puzzle.cellRect(9), { x: 256, y: 428, w: 120, h: 120 });
    const nine = Puzzle.cellRect(9);
    assert.ok(nine.x + nine.w <= LAYOUT.canvasWidth && nine.y + nine.h <= LAYOUT.canvasHeight);
    assert.throws(() => Puzzle.cellRect(10));
    assert.throws(() => Puzzle.cellRect(0));
});

test('PROMPT pins the output contract and page instruction variants are safely forwarded', () => {
    assert.match(Puzzle.PROMPT, /同类/);
    assert.match(Puzzle.PROMPT, /红色编号1-9/);
    assert.match(Puzzle.PROMPT, /targets/);
    assert.equal(Puzzle.pickChallengeInstruction([
        'ACTUALIZAR',
        'Selecciona las cartas iguales',
        'REPORTAR',
    ]), 'Selecciona las cartas iguales');
    assert.equal(Puzzle.pickChallengeInstruction(['contengan manzanas']), 'contengan manzanas');
    assert.equal(Puzzle.pickChallengeInstruction(['contengan un sombrero']), 'contengan un sombrero');
    assert.equal(Puzzle.pickChallengeInstruction(['ACTUALIZAR', 'REPORTAR']), '');
    const variantPrompt = Puzzle.buildPrompt('Selecciona las cartas iguales\nREPORTAR');
    assert.match(variantPrompt, /Selecciona las cartas iguales/);
    assert.doesNotMatch(variantPrompt, /REPORTAR/);
    assert.match(variantPrompt, /targets/);
    assert.equal(Puzzle.buildPrompt(''), Puzzle.PROMPT);
});

test('parseModelAnswer reads targets json with fallbacks and filters invalid numbers', () => {
    assert.deepEqual(Puzzle.parseModelAnswer('{"targets":[2,5,7]}').matches, [2, 5, 7]);
    assert.deepEqual(Puzzle.parseModelAnswer('{"match":[1]}').matches, [1]); // 兼容 match 键。
    assert.deepEqual(Puzzle.parseModelAnswer('```json\n{"targets":[1,3]}\n```').matches, [1, 3]);
    assert.deepEqual(Puzzle.parseModelAnswer('编号是 2、5。').matches, [2, 5]); // 无大括号裸数字兜底。
    assert.deepEqual(Puzzle.parseModelAnswer('{"targets":[0,10,3,3]}').matches, [3]); // 越界过滤 + 去重。
    assert.deepEqual(Puzzle.parseModelAnswer('{"targets":[7,2]}').matches, [2, 7]); // 升序。
    assert.deepEqual(Puzzle.parseModelAnswer('抱歉，我不知道').matches, []);
    assert.deepEqual(Puzzle.parseModelAnswer('{"targets": [').matches, []); // 残缺 JSON 不做裸数字猜测。
    assert.deepEqual(Puzzle.parseModelAnswer('').matches, []);
});

test('answerToPoints maps cell numbers to live page rect centers', () => {
    const rects = Array.from({ length: 9 }, () => ({ x: 0, y: 0, width: 120, height: 120 }));
    assert.deepEqual(Puzzle.answerToPoints([1], rects), [{ n: 1, x: 60, y: 60 }]);
    assert.deepEqual(Puzzle.answerToPoints([9], rects), [{ n: 9, x: 60, y: 60 }]);
    assert.deepEqual(Puzzle.answerToPoints([], rects), []);
});

test('scoreAnswer scores exact match plus cell-level precision and recall', () => {
    const scored = Puzzle.scoreAnswer([1, 2], [2, 3]);
    assert.equal(scored.exact, false);
    assert.equal(scored.precision, 0.5);
    assert.equal(scored.recall, 0.5);
    assert.deepEqual(Puzzle.scoreAnswer([1, 2], [2, 1]), { exact: true, precision: 1, recall: 1, hit: 2 });
    assert.equal(Puzzle.scoreAnswer([], [1]).exact, false);
});
