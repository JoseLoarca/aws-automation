import {GetObjectCommand, S3Client} from "@aws-sdk/client-s3";
import {getSignedUrl} from "@aws-sdk/s3-request-presigner";

const s3Client = new S3Client({});

export const handler = async (event: any) => {
    const { bucketName, objectKey, perplexityResponse } = event;

    const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
    });

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600});

    return {
        signedUrl: signedUrl,
        perplexityResponse: perplexityResponse
    }
}