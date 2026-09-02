import { UserResponseDto } from './user-response.dto';

export class AuthTokensResponseDto {
  user: UserResponseDto;
  accessToken: string;
  refreshToken: string;
  tokenType = 'Bearer';
  expiresIn: number;

  constructor(params: {
    user: UserResponseDto;
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }) {
    this.user = params.user;
    this.accessToken = params.accessToken;
    this.refreshToken = params.refreshToken;
    this.expiresIn = params.expiresIn;
  }
}
