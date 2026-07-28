type RawLocalPackage = {
  id: string;
  name: string;
  version: string;
  filePath: string;
  sizeBytes: number;
  mtime: number;
  isValid: boolean;
  error?: string;
};

export default class LocalPackageModel {
  id: string;
  name: string;
  version: string;
  filePath: string;
  sizeBytes: number;
  mtime: number;
  isValid: boolean;
  error?: string;

  constructor(data: RawLocalPackage) {
    this.id = data.id ?? '';
    this.name = data.name ?? '';
    this.version = data.version ?? '';
    this.filePath = data.filePath ?? '';
    this.sizeBytes = data.sizeBytes ?? 0;
    this.mtime = data.mtime ?? 0;
    this.isValid = data.isValid ?? true;
    this.error = data.error;
  }

  static fromJsonArray(json: string): LocalPackageModel[] {
    if (!json) return [];
    const raw: RawLocalPackage[] = JSON.parse(json);
    return raw.map((item) => new LocalPackageModel(item));
  }
}
