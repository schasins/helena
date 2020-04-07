function compareDefault(a: any, b: any) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Implementation of a sorted array.
 * https://github.com/javascript/sorted-array/blob/master/sorted-array.js
 */
export class SortedArray<T> {
  public array: Array<T>;
  public compare: Function;

  constructor(array: Array<T>, compare: Function) {
    this.array = [];
    this.compare = compare || compareDefault;
    const length = array.length;
    let index = 0;

    while (index < length) this.insert(array[index++]);
  }

  public insert(element: T) {
    const array = this.array;
    const compare = this.compare;
    let index = array.length;

    array.push(element);

    while (index > 0) {
      let i = index, j = --index;

      if (compare(array[i], array[j]) < 0) {
        const temp = array[i];
        array[i] = array[j];
        array[j] = temp;
      }
    }
    return this;
  }

  public search(element: T) {
    const array = this.array;
    const compare = this.compare;
    let high = array.length;
    let low = 0;

    while (high > low) {
      const index = (high + low) / 2 >>> 0;
      const ordering = compare(array[index], element);

      if (ordering < 0) low  = index + 1;
      else if (ordering > 0) high = index;
      else return index;
    }

    return -1;
  }

  public remove(element: T) {
    const index = this.search(element);
    if (index >= 0) this.array.splice(index, 1);
    return this;
  }

  public get(i: number) {
    return this.array[i];
  }

  public length() {
    return this.array.length;
  }
}