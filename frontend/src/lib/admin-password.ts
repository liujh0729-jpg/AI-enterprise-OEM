import { ApiError } from '@enterprise/contracts';
import { authApi } from '@/api/auth';
export async function checkAdminPassword(password:string){
  try{await authApi.verifyPassword(password);return true;}
  catch(error){if(error instanceof ApiError&&error.code===422)return false;throw error;}
}
