export class CurrentUser {
  constructor(
    readonly userId: string,
    readonly username: string,
    readonly role: string,
  ) {}
  isAdmin(): boolean {
    return this.role === 'admin' || this.role === 'super';
  }
}
