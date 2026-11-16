/**
 * Line-level three-way merge used to keep an author's exact formatting.
 *
 * `baseline` and `edited` are two renderings by the same formatter, before and
 * after an edit. Wherever they agree, the change is pure formatting, so the
 * matching lines of `original` are kept verbatim; only regions where they
 * differ are taken from `edited`.
 */

/** For each line of `a`, the index of its partner in a longest common subsequence with `b`, or -1. */
const matchLines = (a: string[], b: string[]): Int32Array => {
    const width = b.length + 1;
    const lengths = new Uint32Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            lengths[i * width + j] = a[i] === b[j]
                ? lengths[(i + 1) * width + j + 1] + 1
                : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
        }
    }
    const partners = new Int32Array(a.length).fill(-1);
    for (let i = 0, j = 0; i < a.length && j < b.length;) {
        if (a[i] === b[j]) partners[i++] = j++;
        else if (lengths[(i + 1) * width + j] >= lengths[i * width + j + 1]) i++;
        else j++;
    }
    return partners;
};

const sameLines = (a: string[], b: string[]) => a.length === b.length && a.every((line, index) => line === b[index]);

/**
 * Merges one region between anchors. Formatting differences are line-for-line, so
 * when the original and baseline regions have the same length their lines
 * correspond by position: unchanged lines come from the original, the rest from `edited`.
 */
const mergeGap = (original: string[], baseline: string[], edited: string[], restyle: boolean): string[] => {
    if (sameLines(baseline, edited)) return original;
    if (original.length !== baseline.length) return edited;
    const toEdited = matchLines(baseline, edited);
    const fromBaseline = new Map<number, number>();
    toEdited.forEach((editedIndex, baselineIndex) => editedIndex !== -1 && fromBaseline.set(editedIndex, baselineIndex));
    return edited.map((line, index) => {
        if (fromBaseline.has(index)) return original[fromBaseline.get(index)!];
        // An edited line that replaces an original line one-for-one takes on its flow style.
        return restyle && edited.length === original.length ? matchFlowPadding(original[index], line) : line;
    });
};

const FLOW_STYLES = [
    { open: '{', close: '}', padded: /\{ (?!\{)/, unpadded: /(?<!\{)\{(?![{\s}])/ },
    { open: '[', close: ']', padded: /\[ /, unpadded: /\[(?![\s\]])/ },
];

/** Gives `line` the same inner padding of flow collections ("{ a: 1 }" vs "{a: 1}") as `reference`. */
const matchFlowPadding = (reference: string, line: string): string => {
    let result = line;
    for (const style of FLOW_STYLES) {
        const open = style.open === '{' ? '\\{' : '\\[';
        const close = style.close === '}' ? '\\}' : '\\]';
        if (style.padded.test(reference) && style.unpadded.test(result)) {
            result = result
                .replace(new RegExp(`(?<![{$])${open}(?![{\\s${close}])`, 'g'), `${style.open} `)
                .replace(new RegExp(`(?<![\\s${open}}])${close}(?!})`, 'g'), ` ${style.close}`);
        } else if (style.unpadded.test(reference) && !style.padded.test(reference) && style.padded.test(result)) {
            result = result
                .replace(new RegExp(`${open} (?!{)`, 'g'), style.open)
                .replace(new RegExp(` ${close}`, 'g'), style.close);
        }
    }
    return result;
};

export const mergeLineEdits = (original: string, baseline: string, edited: string, restyle = true): string => {
    const originalLines = original.split('\n');
    const baselineLines = baseline.split('\n');
    const editedLines = edited.split('\n');
    const toOriginal = matchLines(baselineLines, originalLines);
    const toEdited = matchLines(baselineLines, editedLines);

    // Anchors: baseline lines present, unchanged, in both the original and the edited text.
    const anchors: [number, number, number][] = [[-1, -1, -1]];
    baselineLines.forEach((_line, index) => {
        if (toOriginal[index] !== -1 && toEdited[index] !== -1) anchors.push([index, toOriginal[index], toEdited[index]]);
    });
    anchors.push([baselineLines.length, originalLines.length, editedLines.length]);

    const merged: string[] = [];
    for (let k = 1; k < anchors.length; k++) {
        const [b0, o0, e0] = anchors[k - 1];
        const [b1, o1, e1] = anchors[k];
        merged.push(...mergeGap(
            originalLines.slice(o0 + 1, o1),
            baselineLines.slice(b0 + 1, b1),
            editedLines.slice(e0 + 1, e1),
            restyle,
        ));
        if (o1 < originalLines.length) merged.push(originalLines[o1]);
    }
    return merged.join('\n');
};
