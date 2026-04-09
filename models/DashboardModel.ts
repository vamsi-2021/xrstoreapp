type RawApp = {
  ApplicationName: string;
  FileName: string;
  ZipURL: string;
  LogoURL: string;
  BannerURL: string;
  VersionNumber: string;
  FileSize: string;
  Summary: string;
  PatchNotes: string;
};

export default class DashboardModel {
  applicationName: string;
  fileName: string;
  zipURL: string;
  logoURL: string;
  bannerURL: string;
  versionNumber: string;
  fileSize: string;
  summary: string;
  patchNotes: string;

  constructor(data: RawApp) {
    this.applicationName = data.ApplicationName ?? '';
    this.fileName = data.FileName ?? '';
    this.zipURL = data.ZipURL ?? '';
    this.logoURL = data.LogoURL ?? '';
    this.bannerURL = data.BannerURL ?? '';
    this.versionNumber = data.VersionNumber ?? '';
    this.fileSize = data.FileSize ?? '';
    this.summary = data.Summary ?? '';
    this.patchNotes = data.PatchNotes ?? '';
  }

  static fromList(list: RawApp[]): DashboardModel[] {
    return list.map((item) => new DashboardModel(item));
  }
}
